using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Read-only transport for the installed wallpaper's current dome sizes.
internal sealed class DomeTelemetry : IDisposable
{
    private const string Protocol = "grid-wallpaper-v1";
    private const string TokenProtocol = "grid-wallpaper-token.";
    private const string ResourcePath = "/grid-wallpaper/";
    private const string BootstrapName = "windows-telemetry.js";
    private const string BootstrapPrefix = "/* Grid Wallpaper session telemetry. Installed only. */\nwindow.GridLiveTelemetry&&window.GridLiveTelemetry.connect(";
    private const int MaximumFrameBytes = 4096;
    private const long MaximumSequence = 9007199254740991L;
    private readonly object gate = new object();
    private readonly string installRoot;
    private readonly string mappedOrigin;
    private readonly Action<Dictionary<string, object>> onState;
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private HttpListener listener;
    private Peer peer;
    private Limits limits;
    private string sessionToken;
    private byte[] bootstrap;
    private bool disposed, starting, requested, connected;

    internal sealed class Limits
    {
        internal double MinimumBase, MaximumBase, MinimumPulse, MaximumPulse;
        internal int MaximumCount;
    }

    private sealed class Peer : IDisposable
    {
        internal readonly WebSocket Socket;
        internal readonly CancellationTokenSource Cancellation;
        internal readonly CancellationToken Token;
        internal readonly SemaphoreSlim SendGate = new SemaphoreSlim(1, 1);
        internal bool Ready;
        private int disposed;
        internal long Sequence = -1, FrameWindow = Stopwatch.GetTimestamp();
        internal int WindowFrames;
        internal Peer(WebSocket socket, CancellationToken lifetime)
        {
            Socket = socket;
            Cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime);
            Token = Cancellation.Token;
        }
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            try { Cancellation.Cancel(); } catch (ObjectDisposedException) { }
            try { Socket.Abort(); Socket.Dispose(); } catch (ObjectDisposedException) { }
            Cancellation.Dispose();
        }
    }

    internal DomeTelemetry(string installRoot, Action<Dictionary<string, object>> onState)
    {
        if (onState == null) throw new ArgumentNullException("onState");
        this.installRoot = Path.GetFullPath(installRoot);
        mappedOrigin = LivelyOrigin(this.installRoot);
        this.onState = onState;
    }

    internal bool Connected { get { lock (gate) return connected && !disposed; } }
    internal bool Streaming { get { lock (gate) return connected && requested && !disposed; } }

    internal void Start()
    {
        lock (gate)
        {
            if (disposed) throw new ObjectDisposedException("DomeTelemetry");
            if (listener != null || starting) return;
            starting = true;
            try
            {
                CheckDirectory();
                limits = ReadLimits();
                byte[] random = new byte[32];
                using (RandomNumberGenerator generator = RandomNumberGenerator.Create()) generator.GetBytes(random);
                sessionToken = Convert.ToBase64String(random).TrimEnd('=').Replace('+', '-').Replace('/', '_');
                for (int attempt = 0; attempt < 8; attempt++)
                {
                    using (RandomNumberGenerator generator = RandomNumberGenerator.Create()) generator.GetBytes(random);
                    int port = 49152 + (BitConverter.ToUInt16(random, 0) % 16384);
                    HttpListener candidate = new HttpListener();
                    candidate.AuthenticationSchemes = AuthenticationSchemes.Anonymous;
                    candidate.IgnoreWriteExceptions = true;
                    candidate.Prefixes.Add("http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + ResourcePath);
                    try
                    {
                        candidate.Start();
                        listener = candidate;
                        WriteBootstrap("ws://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + ResourcePath);
                        AcceptConnections(candidate, lifetime.Token);
                        return;
                    }
                    catch (HttpListenerException) { candidate.Close(); listener = null; }
                    catch { candidate.Close(); listener = null; throw; }
                }
                throw new InvalidOperationException("Desktop dome telemetry could not start.");
            }
            finally { starting = false; }
        }
    }

    internal void SetStreaming(bool active)
    {
        Peer current;
        lock (gate)
        {
            if (disposed || requested == active) return;
            requested = active;
            current = peer;
            if (!active) Notify(null);
        }
        if (current != null && current.Ready) SendStreaming(current);
    }

    private async void AcceptConnections(HttpListener source, CancellationToken cancellation)
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                HttpListenerContext context = await source.GetContextAsync().ConfigureAwait(false);
                try
                {
                    HttpListenerRequest request = context.Request;
                    bool allowed = request.IsWebSocketRequest && request.HttpMethod == "GET"
                        && request.LocalEndPoint != null && request.LocalEndPoint.Address.Equals(IPAddress.Loopback)
                        && request.RemoteEndPoint != null && request.RemoteEndPoint.Address.Equals(IPAddress.Loopback)
                        && request.Url != null && request.Url.Host == "127.0.0.1"
                        && ValidateAuthentication(request.Headers["Origin"], request.RawUrl,
                            request.Headers["Sec-WebSocket-Protocol"], sessionToken, mappedOrigin);
                    lock (gate) allowed = allowed && !disposed && peer == null;
                    if (!allowed)
                    {
                        context.Response.StatusCode = 403;
                        context.Response.ContentLength64 = 0;
                        context.Response.Close();
                        continue;
                    }
                    WebSocket socket = (await context.AcceptWebSocketAsync(Protocol, MaximumFrameBytes,
                        TimeSpan.FromSeconds(30)).ConfigureAwait(false)).WebSocket;
                    Peer next = new Peer(socket, cancellation);
                    lock (gate)
                    {
                        if (disposed) { next.Dispose(); return; }
                        peer = next;
                    }
                    ReceiveFrames(next);
                }
                catch (Exception)
                {
                    try { context.Response.Abort(); } catch (Exception) { }
                    if (cancellation.IsCancellationRequested) return;
                }
            }
        }
        catch (Exception)
        {
            lock (gate)
            {
                if (!disposed)
                {
                    if (peer != null) peer.Dispose();
                    peer = null; connected = false; Notify(null);
                }
            }
        }
    }

    private async void ReceiveFrames(Peer current)
    {
        try
        {
            byte[] buffer = new byte[MaximumFrameBytes + 1];
            UTF8Encoding utf8 = new UTF8Encoding(false, true);
            JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = MaximumFrameBytes, RecursionLimit = 8 };
            while (!current.Token.IsCancellationRequested)
            {
                int used = 0, fragments = 0;
                using (CancellationTokenSource receive = CancellationTokenSource.CreateLinkedTokenSource(current.Token))
                {
                    if (!current.Ready) receive.CancelAfter(3000);
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await current.Socket.ReceiveAsync(new ArraySegment<byte>(buffer, used, buffer.Length - used), receive.Token).ConfigureAwait(false);
                        used += result.Count;
                        if (result.MessageType != WebSocketMessageType.Text || used > MaximumFrameBytes || ++fragments > 16) return;
                        if (fragments == 1 && !result.EndOfMessage && current.Ready) receive.CancelAfter(2000);
                    } while (!result.EndOfMessage);
                }
                if (used == 0) return;
                Dictionary<string, object> frame = serializer.DeserializeObject(utf8.GetString(buffer, 0, used)) as Dictionary<string, object>;
                Rectangle area = Screen.PrimaryScreen.WorkingArea;
                double scale;
                using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero)) scale = graphics.DpiX / 96.0;
                if (!current.Ready)
                {
                    object screen;
                    if (!ExactKeys(frame, "kind", "screen") || !Object.Equals(frame["kind"], "hello")
                        || !frame.TryGetValue("screen", out screen) || !ValidateScreen(screen, area, scale)) return;
                    lock (gate)
                    {
                        if (disposed || peer != current) return;
                        current.Ready = true; connected = true;
                        Notify(null);
                    }
                    SendStreaming(current);
                    continue;
                }
                long now = Stopwatch.GetTimestamp();
                if (now - current.FrameWindow >= Stopwatch.Frequency) { current.FrameWindow = now; current.WindowFrames = 0; }
                if (++current.WindowFrames > 60) return;
                Dictionary<string, object> state;
                long sequence;
                if (!ValidateState(frame, limits, area, scale, current.Sequence, out state, out sequence)) return;
                current.Sequence = sequence;
                lock (gate)
                {
                    if (disposed || peer != current) return;
                    // A valid frame already in flight can arrive after the host disables streaming.
                    if (requested) Notify(state);
                }
            }
        }
        catch (Exception) { }
        finally { Drop(current); }
    }

    private async void SendStreaming(Peer current)
    {
        bool acquired = false;
        try
        {
            await current.SendGate.WaitAsync(current.Token).ConfigureAwait(false);
            acquired = true;
            byte[] bytes;
            lock (gate)
            {
                if (disposed || peer != current || !current.Ready) return;
                bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    { { "kind", "stream" }, { "active", requested } }));
            }
            using (CancellationTokenSource send = CancellationTokenSource.CreateLinkedTokenSource(current.Token))
            {
                send.CancelAfter(2000);
                await current.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, send.Token).ConfigureAwait(false);
            }
        }
        catch (Exception) { Drop(current); }
        finally { if (acquired) current.SendGate.Release(); }
    }

    private void Drop(Peer current)
    {
        lock (gate)
        {
            if (peer == current) { peer = null; connected = false; if (!disposed) Notify(null); }
        }
        current.Dispose();
    }

    private void Notify(Dictionary<string, object> state)
    {
        try { onState(state); } catch (Exception) { }
    }

    private static string LivelyOrigin(string directory)
    {
        // Lively 2.2.1 maps each local folder to the first eight SHA-1 bytes plus .localhost.
        // This mirrors its address format only; the random session token authenticates the peer.
        using (SHA1 hash = SHA1.Create())
            return "https://" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(directory)), 0, 8)
                .Replace("-", "").ToLowerInvariant() + ".localhost";
    }

    internal static bool ValidateAuthentication(string origin, string rawPath, string protocols, string token, string mappedOrigin = null)
    {
        if (!(origin == "null" || mappedOrigin != null && origin == mappedOrigin)
            || rawPath != ResourcePath || protocols == null || protocols.Length > 128 || !TokenValid(token)) return false;
        string[] offered = protocols.Split(',');
        if (offered.Length != 2) return false;
        string secret = null;
        bool version = false;
        foreach (string item in offered)
        {
            string value = item.Trim();
            if (value == Protocol) version = true;
            else if (value.StartsWith(TokenProtocol, StringComparison.Ordinal)) secret = value.Substring(TokenProtocol.Length);
            else return false;
        }
        if (!version || !TokenValid(secret)) return false;
        int difference = 0;
        for (int index = 0; index < token.Length; index++) difference |= token[index] ^ secret[index];
        return difference == 0;
    }

    private static bool TokenValid(string value)
    {
        if (value == null || value.Length != 43) return false;
        foreach (char character in value)
            if (!(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z')
                && !(character >= '0' && character <= '9') && character != '-' && character != '_') return false;
        return true;
    }

    internal static bool ValidateState(Dictionary<string, object> frame, Limits bounds, Rectangle area, double scale,
        long previousSequence, out Dictionary<string, object> state, out long sequence)
    {
        state = null; sequence = -1;
        if (!ValidLimits(bounds) || !ExactKeys(frame, "kind", "sequence", "autoSize", "paused", "bases", "sizes", "screen")
            || !Object.Equals(frame["kind"], "domes") || !(frame["autoSize"] is bool) || !(frame["paused"] is bool)) return false;
        double numericSequence;
        if (!Number(frame["sequence"], out numericSequence) || numericSequence < 0 || numericSequence > MaximumSequence
            || Math.Truncate(numericSequence) != numericSequence || numericSequence <= previousSequence || !ValidateScreen(frame["screen"], area, scale)) return false;
        IList bases = frame["bases"] as IList, sizes = frame["sizes"] as IList;
        if (bases == null || sizes == null || bases.Count < 1 || bases.Count > bounds.MaximumCount || sizes.Count != bases.Count) return false;
        double[] normalizedBases = new double[bases.Count], normalizedSizes = new double[bases.Count];
        bool autoSize = (bool)frame["autoSize"];
        for (int index = 0; index < bases.Count; index++)
        {
            double basis, size;
            if (!Number(bases[index], out basis) || !Number(sizes[index], out size) || basis < bounds.MinimumBase || basis > bounds.MaximumBase) return false;
            double minimum = autoSize ? basis * bounds.MinimumPulse : basis, maximum = autoSize ? basis * bounds.MaximumPulse : basis;
            double tolerance = Math.Max(1, basis) * 1e-9;
            if (size < minimum - tolerance || size > maximum + tolerance) return false;
            normalizedBases[index] = basis; normalizedSizes[index] = Math.Max(minimum, Math.Min(maximum, size));
        }
        sequence = (long)numericSequence;
        state = new Dictionary<string, object> { { "kind", "domes" }, { "sequence", sequence }, { "autoSize", autoSize },
            { "paused", (bool)frame["paused"] }, { "bases", normalizedBases }, { "sizes", normalizedSizes },
            { "screen", new Dictionary<string, object> { { "left", area.Left / scale }, { "top", area.Top / scale },
                { "width", area.Width / scale }, { "height", area.Height / scale }, { "scale", scale } } } };
        return true;
    }

    private static bool ValidateScreen(object value, Rectangle area, double expectedScale)
    {
        Dictionary<string, object> screen = value as Dictionary<string, object>;
        double left, top, width, height, scale;
        if (!ExactKeys(screen, "left", "top", "width", "height", "scale") || !Number(screen["left"], out left)
            || !Number(screen["top"], out top) || !Number(screen["width"], out width) || !Number(screen["height"], out height)
            || !Number(screen["scale"], out scale) || scale < 0.5 || scale > 8 || width <= 0 || height <= 0
            || Double.IsNaN(expectedScale) || Double.IsInfinity(expectedScale) || Math.Abs(scale - expectedScale) > 0.01) return false;
        double tolerance = Math.Max(1, scale);
        return Math.Abs(left * scale - area.Left) <= tolerance && Math.Abs(top * scale - area.Top) <= tolerance
            && Math.Abs(width * scale - area.Width) <= tolerance && Math.Abs(height * scale - area.Height) <= tolerance;
    }

    private static bool ExactKeys(Dictionary<string, object> value, params string[] keys)
    {
        if (value == null || value.Count != keys.Length) return false;
        foreach (string key in keys) if (!value.ContainsKey(key)) return false;
        return true;
    }

    private static bool Number(object value, out double result)
    {
        result = 0;
        if (!(value is int) && !(value is long) && !(value is double) && !(value is decimal) && !(value is float)) return false;
        result = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        return !Double.IsNaN(result) && !Double.IsInfinity(result);
    }

    private static bool ValidLimits(Limits value)
    {
        double unused;
        return value != null && Number(value.MinimumBase, out unused) && Number(value.MaximumBase, out unused)
            && Number(value.MinimumPulse, out unused) && Number(value.MaximumPulse, out unused)
            && value.MinimumBase > 0 && value.MaximumBase >= value.MinimumBase && value.MinimumPulse > 0
            && value.MaximumPulse >= value.MinimumPulse && value.MaximumPulse <= 1 && value.MaximumCount >= 1 && value.MaximumCount <= 10;
    }

    private Limits ReadLimits()
    {
        string file = Path.Combine(installRoot, "windows-integration.json");
        CheckFile(file);
        if (new FileInfo(file).Length > 65536) throw new InvalidDataException("Telemetry integration metadata is invalid.");
        Dictionary<string, object> integration = new JavaScriptSerializer { MaxJsonLength = 65536, RecursionLimit = 8 }
            .DeserializeObject(File.ReadAllText(file)) as Dictionary<string, object>;
        object value;
        if (integration == null || !integration.TryGetValue("domeTelemetry", out value)) throw new InvalidDataException("Telemetry integration metadata is missing.");
        Dictionary<string, object> telemetry = value as Dictionary<string, object>;
        if (!ExactKeys(telemetry, "domeSize", "pulse", "maximumCount")) throw new InvalidDataException("Telemetry limits are invalid.");
        Dictionary<string, object> size = telemetry["domeSize"] as Dictionary<string, object>, pulse = telemetry["pulse"] as Dictionary<string, object>;
        Limits result = new Limits();
        double count;
        if (size == null || pulse == null || !size.ContainsKey("min") || !size.ContainsKey("max") || !pulse.ContainsKey("min") || !pulse.ContainsKey("max")
            || !Number(size["min"], out result.MinimumBase) || !Number(size["max"], out result.MaximumBase)
            || !Number(pulse["min"], out result.MinimumPulse) || !Number(pulse["max"], out result.MaximumPulse)
            || !Number(telemetry["maximumCount"], out count) || count < 1 || count > 10 || Math.Truncate(count) != count)
            throw new InvalidDataException("Telemetry limits are invalid.");
        result.MaximumCount = (int)count;
        if (!ValidLimits(result)) throw new InvalidDataException("Telemetry limits are invalid.");
        return result;
    }

    private void CheckDirectory()
    {
        if (!Directory.Exists(installRoot) || installRoot.StartsWith(@"\\", StringComparison.Ordinal)) throw new IOException("Telemetry requires a local installation directory.");
        for (DirectoryInfo directory = new DirectoryInfo(installRoot); directory != null; directory = directory.Parent)
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Telemetry paths must not be links.");
    }

    private static void CheckFile(string file)
    {
        try { if ((File.GetAttributes(file) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) throw new IOException("Telemetry files must not be links or directories."); }
        catch (FileNotFoundException) { }
    }

    private void WriteBootstrap(string url)
    {
        CheckDirectory();
        string destination = Path.Combine(installRoot, BootstrapName), temporary = Path.Combine(installRoot, ".grid-telemetry-" + Guid.NewGuid().ToString("N") + ".tmp");
        CheckFile(destination);
        if (File.Exists(destination) && (new FileInfo(destination).Length > MaximumFrameBytes
            || !File.ReadAllText(destination).StartsWith(BootstrapPrefix, StringComparison.Ordinal))) throw new IOException("An unrelated telemetry bootstrap already exists.");
        FileSecurity security = new FileSecurity();
        SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
        security.SetOwner(user);
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(user, FileSystemRights.FullControl, AccessControlType.Allow));
        byte[] bytes = Encoding.UTF8.GetBytes(BootstrapPrefix + new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            { { "url", url }, { "token", sessionToken } }) + ");\n");
        bool temporaryOwned = false;
        try
        {
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileSystemRights.FullControl,
                FileShare.None, 4096, FileOptions.WriteThrough, security))
            {
                temporaryOwned = true;
                stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
            }
            CheckDirectory(); CheckFile(destination);
            if (File.Exists(destination))
            {
                File.SetAccessControl(destination, security);
                File.Replace(temporary, destination, null);
            }
            else File.Move(temporary, destination);
            bootstrap = bytes;
        }
        finally
        {
            if (temporaryOwned)
            {
                CheckDirectory(); CheckFile(temporary);
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            lifetime.Cancel();
            if (listener != null) { listener.Close(); listener = null; }
            if (peer != null) { peer.Dispose(); peer = null; }
            connected = false; requested = false; Notify(null);
        }
        lifetime.Dispose();
        try
        {
            CheckDirectory();
            string file = Path.Combine(installRoot, BootstrapName);
            CheckFile(file);
            if (bootstrap != null && File.Exists(file) && new FileInfo(file).Length == bootstrap.Length)
            {
                byte[] current = File.ReadAllBytes(file);
                int difference = current.Length ^ bootstrap.Length;
                for (int index = 0; index < current.Length && index < bootstrap.Length; index++) difference |= current[index] ^ bootstrap[index];
                if (difference == 0) File.Delete(file);
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    internal static int SelfTest()
    {
        string token = new string('a', 43), header = Protocol + ", " + TokenProtocol + token;
        string mapped = LivelyOrigin(@"C:\wallpaper fixture");
        if (!ValidateAuthentication(mapped, ResourcePath, header, token, mapped)
            || ValidateAuthentication("https://other.localhost", ResourcePath, header, token, mapped)
            || ValidateAuthentication(mapped + ":443", ResourcePath, header, token, mapped)
            || ValidateAuthentication(null, ResourcePath, header, token, mapped)) return 71;
        if (!ValidateAuthentication("null", ResourcePath, header, token)
            || ValidateAuthentication(null, ResourcePath, header, token) || ValidateAuthentication("https://example.com", ResourcePath, header, token)
            || ValidateAuthentication("null", ResourcePath + "?token=" + token, header, token)
            || ValidateAuthentication("null", ResourcePath, header + ", extra", token)
            || ValidateAuthentication("null", ResourcePath, header, new string('b', 43))) return 61;
        Limits bounds = new Limits { MinimumBase = 0.1, MaximumBase = 3, MinimumPulse = 0.55, MaximumPulse = 1, MaximumCount = 10 };
        Rectangle area = new Rectangle(0, 0, 1920, 1140);
        Dictionary<string, object> screen = new Dictionary<string, object> { { "left", 0 }, { "top", 0 }, { "width", 1536 }, { "height", 912 }, { "scale", 1.25 } };
        Dictionary<string, object> frame = new Dictionary<string, object> { { "kind", "domes" }, { "sequence", 1 }, { "autoSize", true },
            { "paused", false }, { "bases", new double[] { 0.1, 3 } }, { "sizes", new double[] { 0.055, 3 } }, { "screen", screen } };
        Dictionary<string, object> state;
        long sequence;
        if (!ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence) || sequence != 1) return 62;
        if (ValidateState(frame, bounds, area, 1.25, 1, out state, out sequence)) return 63;
        frame["autoSize"] = false;
        if (ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence)) return 64;
        frame["sizes"] = new double[] { 0.1, 3 };
        if (!ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence)) return 65;
        foreach (object invalid in new object[] { Double.NaN, Double.PositiveInfinity, "2", true, 1.5, 9007199254740992d })
        {
            frame["sequence"] = invalid;
            if (ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence)) return 66;
        }
        frame["sequence"] = 2;
        screen["left"] = 1536;
        if (ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence)) return 67;
        screen["left"] = 0;
        frame["command"] = "write";
        if (ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence)) return 68;
        frame.Remove("command"); frame["sizes"] = new double[] { 0.1 };
        if (ValidateState(frame, bounds, area, 1.25, -1, out state, out sequence)) return 69;
        bounds.MaximumCount = 11;
        if (ValidLimits(bounds)) return 70;
        Console.WriteLine("Dome telemetry authentication, bounds, sequence and display validation passed.");
        return 0;
    }
}
