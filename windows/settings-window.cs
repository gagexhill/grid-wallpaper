// A reusable native window for the repository's existing HTML settings panel.
// Lively remains the owner of persisted wallpaper properties.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]

internal static class SettingsProgram
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
    private const string WindowMarker = "GridWallpaperSettingsWindow";
    internal const int OpenMessage = 0x8001;
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetProp(IntPtr window, string name);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool SetProp(IntPtr window, string name, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr RemoveProp(IntPtr window, string name);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out WindowRectangle rectangle);
    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRectangle { internal int Left, Top, Right, Bottom; }
    private static readonly int CurrentProcessId = Process.GetCurrentProcess().Id;

    [STAThread]
    private static int Main(string[] args)
    {
        SetProcessDPIAware();
        if (args.Length == 1 && args[0] == "--self-test")
        {
            int result = SettingsData.SelfTest();
            if (result == 0) result = SettingsGeometry.SelfTest();
            if (result == 0) result = SettingsInteraction.SelfTest();
            if (result == 0) result = DomeTelemetry.SelfTest();
            return result == 0 ? LauncherVisuals.SelfTest() : result;
        }
        string executable = Path.GetFullPath(Application.ExecutablePath);
        string installDirectory = Path.GetDirectoryName(executable);
        string id;
        using (SHA256 hash = SHA256.Create())
            id = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(executable.ToUpperInvariant()))).Replace("-", "");
        string shutdownName = "Local\\GridWallpaperSettingsShutdown-" + id;
        if (args.Length == 1 && args[0] == "--close") return CloseExisting(executable, shutdownName);
        if (args.Length == 1 && args[0] == "--status") return PrintStatus(executable);
        bool warm = args.Length == 1 && args[0] == "--warm";
        Point anchor = SettingsGeometry.DefaultAnchor;
        if (!warm)
        {
            if (args.Length != 2 || args[0] != "--uri") return 2;
            try
            {
                Dictionary<string, object> integration = SettingsData.ObjectValue(SettingsData.ReadJson(Path.Combine(installDirectory, "windows-integration.json")));
                object scheme;
                if (!integration.TryGetValue("settingsUri", out scheme) || !(scheme is string)
                    || !SettingsGeometry.TryParseUri((string)scheme, args[1], out anchor)) return 2;
            }
            catch (Exception) { return 2; }
        }
        bool created;
        using (Mutex singleton = new Mutex(true, "Local\\GridWallpaperSettings-" + id, out created))
        {
            if (!created) return warm ? 0 : OpenExisting(executable, anchor);
            using (EventWaitHandle shutdown = new EventWaitHandle(false, EventResetMode.ManualReset, shutdownName))
            {
                try
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new SettingsApplicationContext(installDirectory, warm, anchor, shutdown));
                    return 0;
                }
                catch (Exception error)
                {
                    if (!warm)
                    {
                        string message = error is SettingsFailure ? error.Message
                            : "The settings window could not start. Rerun Grid Wallpaper setup and check that Microsoft Edge WebView2 Runtime is installed.";
                        MessageBox.Show(message, "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                    return 1;
                }
                finally { singleton.ReleaseMutex(); }
            }
        }
    }

    internal static void MarkWindow(IntPtr window) { SetProp(window, WindowMarker, new IntPtr(1)); }
    internal static void UnmarkWindow(IntPtr window)
    {
        foreach (string suffix in new string[] { "", "Ready", "Suspended", "Radius", "Region", "Panel", "Launcher", "Dragging", "InteractiveMicros", "OpenSequence", "InteractiveSequence", "TelemetryAvailable", "TelemetryConnected", "TelemetryStreaming" }) RemoveProp(window, WindowMarker + suffix);
    }

    internal static void SetWindowState(IntPtr window, bool ready, bool suspended, double radius, bool region)
    {
        SetProp(window, WindowMarker + "Ready", new IntPtr(ready ? 1 : 0));
        SetProp(window, WindowMarker + "Suspended", new IntPtr(suspended ? 1 : 0));
        SetProp(window, WindowMarker + "Radius", new IntPtr((int)Math.Round(radius * 1000)));
        SetProp(window, WindowMarker + "Region", new IntPtr(region ? 1 : 0));
    }

    internal static void SetMetric(IntPtr window, string name, long value) { SetProp(window, WindowMarker + name, new IntPtr(value)); }
    private static IntPtr Metric(IntPtr window, string name) { return window == IntPtr.Zero ? IntPtr.Zero : GetProp(window, WindowMarker + name); }

    private static int PrintStatus(string executable)
    {
        bool running = false;
        IntPtr window = IntPtr.Zero;
        foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable)))
        {
            using (process)
            {
                try
                {
                    if (process.Id == CurrentProcessId || !SettingsData.SamePath(process.MainModule.FileName, executable) || process.HasExited) continue;
                    running = true;
                    window = FindSettingsWindow(process.Id);
                    if (window != IntPtr.Zero) break;
                }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException) { }
            }
        }
        IntPtr panel = Metric(window, "Panel"), launcher = Metric(window, "Launcher");
        WindowRectangle bounds = new WindowRectangle(), launcherBounds = new WindowRectangle();
        if (panel != IntPtr.Zero) GetWindowRect(panel, out bounds);
        if (launcher != IntPtr.Zero) GetWindowRect(launcher, out launcherBounds);
        Rectangle primaryBounds = Screen.PrimaryScreen.Bounds;
        Rectangle primaryWorkArea = Screen.PrimaryScreen.WorkingArea;
        Console.WriteLine(new JavaScriptSerializer().Serialize(new
        {
            running = running,
            ready = window != IntPtr.Zero && GetProp(window, WindowMarker + "Ready") == new IntPtr(1),
            visible = panel != IntPtr.Zero && IsWindowVisible(panel),
            suspended = window != IntPtr.Zero && GetProp(window, WindowMarker + "Suspended") == new IntPtr(1),
            left = bounds.Left, top = bounds.Top, width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top,
            region = window != IntPtr.Zero && GetProp(window, WindowMarker + "Region") == new IntPtr(1),
            radius = window == IntPtr.Zero ? 0d : GetProp(window, WindowMarker + "Radius").ToInt64() / 1000d,
            inputToInteractiveMilliseconds = Metric(window, "InteractiveMicros").ToInt64() / 1000d,
            openSequence = Metric(window, "OpenSequence").ToInt64(),
            interactiveSequence = Metric(window, "InteractiveSequence").ToInt64(),
            telemetry = new
            {
                available = Metric(window, "TelemetryAvailable") == new IntPtr(1),
                connected = Metric(window, "TelemetryConnected") == new IntPtr(1),
                streaming = Metric(window, "TelemetryStreaming") == new IntPtr(1)
            },
            launcher = new
            {
                visible = launcher != IntPtr.Zero && IsWindowVisible(launcher),
                left = launcherBounds.Left, top = launcherBounds.Top,
                width = launcherBounds.Right - launcherBounds.Left, height = launcherBounds.Bottom - launcherBounds.Top,
                dragging = Metric(window, "Dragging") == new IntPtr(1),
                captured = launcher != IntPtr.Zero && DesktopLauncher.HasCapture(launcher),
                topmost = launcher != IntPtr.Zero && DesktopLauncher.IsTopmost(launcher),
                shellOwned = launcher != IntPtr.Zero && DesktopLauncher.IsShellOwned(launcher),
                centerHitOwned = launcher != IntPtr.Zero && DesktopLauncher.HitWindow(new Point((launcherBounds.Left + launcherBounds.Right) / 2,
                    (launcherBounds.Top + launcherBounds.Bottom) / 2)) == launcher
            },
            screen = new
            {
                left = primaryBounds.Left, top = primaryBounds.Top, width = primaryBounds.Width, height = primaryBounds.Height,
                workArea = new { left = primaryWorkArea.Left, top = primaryWorkArea.Top, width = primaryWorkArea.Width, height = primaryWorkArea.Height }
            }
        }));
        return 0;
    }

    private static IntPtr FindSettingsWindow(int processId)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == processId && GetProp(window, WindowMarker) == new IntPtr(1))
            { result = window; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    private static int OpenExisting(string executable, Point anchor)
    {
        // The hidden HWND is created before WebView2 or Lively startup is awaited.
        for (int attempt = 0; attempt < 30; attempt++)
        {
            foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable)))
            {
                using (process)
                {
                    try
                    {
                        if (process.Id == CurrentProcessId || !SettingsData.SamePath(process.MainModule.FileName, executable)) continue;
                        IntPtr window = FindSettingsWindow(process.Id);
                        if (window != IntPtr.Zero)
                        {
                            AllowSetForegroundWindow(process.Id);
                            return PostMessage(window, OpenMessage, new IntPtr(anchor.X), new IntPtr(anchor.Y)) ? 0 : 2;
                        }
                    }
                    catch (System.ComponentModel.Win32Exception) { }
                    catch (InvalidOperationException) { }
                }
            }
            Thread.Sleep(100);
        }
        return 2;
    }

    private static int CloseExisting(string executable, string shutdownName)
    {
        try { using (EventWaitHandle shutdown = EventWaitHandle.OpenExisting(shutdownName)) shutdown.Set(); }
        catch (WaitHandleCannotBeOpenedException) { }
        Stopwatch elapsed = Stopwatch.StartNew();
        HashSet<int> notified = new HashSet<int>();
        do
        {
            bool running = false;
            foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable)))
            {
                using (process)
                {
                    try
                    {
                        if (process.Id == CurrentProcessId || !SettingsData.SamePath(process.MainModule.FileName, executable) || process.HasExited) continue;
                        running = true;
                        IntPtr window = FindSettingsWindow(process.Id);
                        if (window != IntPtr.Zero && !notified.Contains(process.Id))
                        {
                            // Also supports shutting down the previous non-warm helper version.
                            if (PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero)) notified.Add(process.Id);
                        }
                    }
                    catch (System.ComponentModel.Win32Exception) { return 2; }
                    catch (InvalidOperationException) { }
                }
            }
            if (!running) return 0;
            Thread.Sleep(100);
        } while (elapsed.ElapsedMilliseconds < 15000);
        return 2;
    }
}

internal sealed class SettingsApplicationContext : ApplicationContext
{
    private readonly string installDirectory;
    private readonly EventWaitHandle shutdown;
    private readonly SupervisorWindow supervisor = new SupervisorWindow();
    private readonly System.Windows.Forms.Timer dormant = new System.Windows.Forms.Timer();
    private readonly System.Windows.Forms.Timer nativeChange = new System.Windows.Forms.Timer();
    private readonly FileSystemWatcher nativeWatcher;
    private RegisteredWaitHandle shutdownWait;
    private SettingsWindow panel;
    private Point anchor;
    private bool checking, closing, openRequested;

    internal SettingsApplicationContext(string directory, bool warm, Point requestedAnchor, EventWaitHandle shutdownEvent)
    {
        installDirectory = directory;
        shutdown = shutdownEvent;
        anchor = requestedAnchor;
        openRequested = !warm;
        MainForm = supervisor;
        Dictionary<string, object> host = SettingsData.ObjectValue(SettingsData.ReadJson(Path.Combine(directory, "windows-host.json")));
        nativeWatcher = new FileSystemWatcher(SettingsData.RequiredPath(host, "LivelyDataDirectory"));
        nativeWatcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName;
        nativeWatcher.Changed += NativeChanged;
        nativeWatcher.Created += NativeChanged;
        nativeWatcher.Deleted += NativeChanged;
        nativeWatcher.Renamed += NativeChanged;
        nativeChange.Interval = 250;
        nativeChange.Tick += delegate { nativeChange.Stop(); RecheckActiveWallpaper(); };
        nativeWatcher.EnableRaisingEvents = true;
        supervisor.OpenRequested += delegate(Point value)
        {
            anchor = value;
            if (panel != null) panel.TogglePanel(value, Stopwatch.GetTimestamp());
            else { openRequested = true; CheckForWallpaper(); }
        };
        supervisor.ExitRequested += Stop;
        dormant.Interval = 3000;
        dormant.Tick += delegate { CheckForWallpaper(); };
        RegisterShutdown();
        supervisor.BeginInvoke(new Action(CheckForWallpaper));
    }

    private void RegisterShutdown()
    {
        if (shutdownWait != null) shutdownWait.Unregister(null);
        shutdownWait = ThreadPool.RegisterWaitForSingleObject(shutdown, delegate
        {
            try { supervisor.BeginInvoke(new Action(Stop)); } catch (InvalidOperationException) { }
        }, null, Timeout.Infinite, true);
    }

    private async void CheckForWallpaper()
    {
        if (checking || closing || panel != null) return;
        checking = true;
        try
        {
            SettingsData loaded = await Task.Run(delegate { return SettingsData.Load(installDirectory); });
            if (closing) return;
            dormant.Stop();
            panel = new SettingsWindow(installDirectory, !openRequested, anchor, shutdown, supervisor.Handle, loaded);
            openRequested = false;
            panel.ShutdownCancelled += delegate { closing = false; shutdown.Reset(); RegisterShutdown(); };
            panel.FormClosed += delegate
            {
                panel = null;
                SettingsProgram.SetWindowState(supervisor.Handle, false, false, 0, false);
                foreach (string key in new string[] { "Panel", "Launcher", "Dragging", "InteractiveMicros", "OpenSequence", "InteractiveSequence" }) SettingsProgram.SetMetric(supervisor.Handle, key, 0);
                if (closing) Finish(); else dormant.Start();
            };
        }
        catch (Exception error)
        {
            if (openRequested && !closing)
            {
                openRequested = false;
                MessageBox.Show(error is SettingsFailure ? error.Message : "The settings window could not start. Rerun Grid Wallpaper setup.",
                    "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            if (!closing) dormant.Start();
        }
        finally { checking = false; }
    }

    private void NativeChanged(object sender, FileSystemEventArgs e)
    {
        if (!String.Equals(e.Name, "Settings.json", StringComparison.OrdinalIgnoreCase)
            && !String.Equals(e.Name, "WallpaperLayout.json", StringComparison.OrdinalIgnoreCase)) return;
        try { supervisor.BeginInvoke(new Action(delegate { if (!closing) { nativeChange.Stop(); nativeChange.Start(); } })); }
        catch (InvalidOperationException) { }
    }

    private async void RecheckActiveWallpaper()
    {
        if (closing) return;
        if (panel == null) { CheckForWallpaper(); return; }
        SettingsWindow expected = panel;
        bool valid = false;
        for (int attempt = 0; attempt < 2; attempt++)
        {
            try { await Task.Run(delegate { SettingsData.Load(installDirectory); }); valid = true; break; }
            catch (Exception) { }
            if (attempt == 0) await Task.Delay(100);
        }
        if (!closing && !valid && panel == expected) expected.StopForWallpaperChange();
    }

    private void Stop()
    {
        if (closing) return;
        closing = true;
        dormant.Stop();
        nativeChange.Stop();
        if (panel != null) panel.StopForInstaller(); else Finish();
    }

    private void Finish()
    {
        dormant.Dispose();
        nativeChange.Dispose();
        nativeWatcher.Dispose();
        if (shutdownWait != null) shutdownWait.Unregister(null);
        supervisor.PermitClose = true;
        supervisor.Close();
    }

    private sealed class SupervisorWindow : Form
    {
        internal event Action<Point> OpenRequested;
        internal event Action ExitRequested;
        internal bool PermitClose;
        internal SupervisorWindow() { ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.None; CreateHandle(); }
        protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SettingsProgram.MarkWindow(Handle); }
        protected override void OnHandleDestroyed(EventArgs e) { SettingsProgram.UnmarkWindow(Handle); base.OnHandleDestroyed(e); }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == SettingsProgram.OpenMessage)
            {
                long x = message.WParam.ToInt64(), y = message.LParam.ToInt64();
                if (x >= 0 && x <= SettingsGeometry.CoordinateScale && y >= 0 && y <= SettingsGeometry.CoordinateScale && OpenRequested != null)
                    OpenRequested(new Point((int)x, (int)y));
                return;
            }
            if (message.Msg == 0x10 && !PermitClose) { if (ExitRequested != null) ExitRequested(); return; }
            base.WndProc(ref message);
        }
    }
}

internal sealed class LauncherVisuals : IDisposable
{
    internal Bitmap[] Frames;
    internal Size Size;
    internal int Gap;
    internal static LauncherVisuals Parse(object value, double scale)
    {
        Dictionary<string, object> source = SettingsData.ObjectValue(value);
        double width = Scalar(source, "width", 48, 128), height = Scalar(source, "height", 48, 128);
        double gap = Scalar(source, "gap", 0, 64);
        Scalar(source, "radius", 0, Math.Min(width, height) / 2);
        object framesValue;
        IList frames = source.TryGetValue("frames", out framesValue) ? framesValue as IList : null;
        int pixelWidth = (int)Math.Round(width * scale, MidpointRounding.AwayFromZero), pixelHeight = (int)Math.Round(height * scale, MidpointRounding.AwayFromZero);
        if (frames == null || frames.Count != 6 || pixelWidth < 1 || pixelHeight < 1 || pixelWidth > 512 || pixelHeight > 512)
            throw new SettingsFailure("The desktop settings button is invalid.");
        LauncherVisuals result = new LauncherVisuals { Frames = new Bitmap[6], Size = new Size(pixelWidth, pixelHeight), Gap = (int)Math.Round(gap * scale) };
        try
        {
            for (int i = 0; i < frames.Count; i++)
            {
                string text = frames[i] as string;
                if (text == null || text.Length > 24000) throw new SettingsFailure("The desktop settings button image is invalid.");
                byte[] png = Convert.FromBase64String(text);
                byte[] signature = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 };
                if (png.Length < 24 || png.Length > 18000) throw new SettingsFailure("The desktop settings button image is invalid.");
                for (int b = 0; b < signature.Length; b++) if (png[b] != signature[b]) throw new SettingsFailure("The desktop settings button image is invalid.");
                int encodedWidth = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
                int encodedHeight = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
                if (encodedWidth != pixelWidth || encodedHeight != pixelHeight) throw new SettingsFailure("The desktop settings button scale is invalid.");
                using (MemoryStream stream = new MemoryStream(png))
                using (Bitmap decoded = new Bitmap(stream))
                {
                    Bitmap frame = new Bitmap(pixelWidth, pixelHeight, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                    using (Graphics graphics = Graphics.FromImage(frame))
                    { graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy; graphics.DrawImageUnscaled(decoded, 0, 0); }
                    result.Frames[i] = frame;
                }
            }
            return result;
        }
        catch { result.Dispose(); throw; }
    }
    private static double Scalar(Dictionary<string, object> source, string name, double min, double max)
    {
        object value; double number;
        if (!source.TryGetValue(name, out value) || !SettingsData.NumberValue(value, out number) || number < min || number > max)
            throw new SettingsFailure("The desktop settings button geometry is invalid.");
        return number;
    }
    public void Dispose() { if (Frames != null) foreach (Bitmap frame in Frames) if (frame != null) frame.Dispose(); }
    internal static int SelfTest()
    {
        string image;
        using (Bitmap bitmap = new Bitmap(77, 72))
        using (MemoryStream stream = new MemoryStream())
        { bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png); image = Convert.ToBase64String(stream.ToArray()); }
        Dictionary<string, object> source = new Dictionary<string, object>
        {
            { "width", 51 }, { "height", 48 }, { "gap", 16 }, { "radius", 24 },
            { "frames", new object[] { image, image, image, image, image, image } }
        };
        using (LauncherVisuals valid = Parse(source, 1.5)) if (valid.Size != new Size(77, 72) || valid.Gap != 24) return 30;
        foreach (object invalid in new object[] { 47, 129, Double.NaN, Double.PositiveInfinity, "51" })
        {
            source["width"] = invalid;
            try { using (LauncherVisuals unexpected = Parse(source, 1.5)) { } return 31; }
            catch (SettingsFailure) { }
        }
        source["width"] = 51;
        source["frames"] = new object[] { image, image, image, image, image };
        try { using (LauncherVisuals unexpected = Parse(source, 1.5)) { } return 32; } catch (SettingsFailure) { }
        source["frames"] = new object[] { "AAAA", image, image, image, image, image };
        try { using (LauncherVisuals unexpected = Parse(source, 1.5)) { } return 33; } catch (SettingsFailure) { }
        Console.WriteLine("Launcher image, bounds and fractional-DPI validation passed.");
        return 0;
    }
}

internal sealed class DesktopLauncher : Form
{
    private delegate bool EnumWindowCallback(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct Blend { internal byte Operation, Flags, Alpha, Format; }
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr item);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UpdateLayeredWindow(IntPtr window, IntPtr destinationDC, ref Point destination, ref Size size, IntPtr sourceDC, ref Point origin, int colorKey, ref Blend blend, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, out bool value, uint flags);
    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        internal int Size, Flags;
        internal IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        internal int Left, Top, Right, Bottom;
    }
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "WindowFromPoint")] internal static extern IntPtr HitWindow(Point point);
    internal static bool HasCapture(IntPtr window)
    {
        uint process;
        uint thread = GetWindowThreadProcessId(window, out process);
        GuiThreadInfo info = new GuiThreadInfo { Size = Marshal.SizeOf(typeof(GuiThreadInfo)) };
        return thread != 0 && GetGUIThreadInfo(thread, ref info) && info.Capture == window;
    }
    internal static bool IsTopmost(IntPtr window) { return (GetWindowLongPtr(window, -20).ToInt64() & 8) != 0; }
    internal static bool IsShellOwned(IntPtr window) { return GetWindow(window, 4) == GetShellWindow(); }
    private readonly LauncherVisuals visuals;
    private readonly IntPtr statusWindow;
    private readonly IntPtr companionPanel;
    private readonly double scale;
    private readonly Action<Point, long> toggle;
    private readonly Action<Point> moved;
    private readonly Action<IntPtr> deactivated;
    private readonly System.Windows.Forms.Timer animation = new System.Windows.Forms.Timer();
    private readonly IntPtr[] bitmaps = new IntPtr[6];
    private bool pressed, dragging, releasing;
    private bool keyPressed;
    private Point downScreen, downWindow;
    private int frame, targetFrame;
    private bool snapping;
    private Point snapStart, snapTarget;
    private long snapStarted;
    private bool snappedRight = true;
    private bool initialized;
    private double normalizedY;
    private readonly string positionFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grid Wallpaper", "launcher-position.json");

    internal DesktopLauncher(LauncherVisuals images, double displayScale, IntPtr status, Action<Point, long> onClick,
        Action<Point> onMove, Action<IntPtr> onDeactivate, IntPtr panelWindow)
    {
        visuals = images; scale = displayScale; statusWindow = status; toggle = onClick; moved = onMove; deactivated = onDeactivate;
        companionPanel = panelWindow;
        Text = "Grid Wallpaper Settings Button";
        AccessibleName = Text;
        AccessibleDescription = "Open wallpaper settings. Drag to move the button. Press Enter or Space to open settings.";
        AccessibleRole = AccessibleRole.PushButton;
        Cursor = Cursors.Hand;
        KeyPreview = true;
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = false; StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None; ClientSize = visuals.Size;
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        Location = new Point(area.Right - Width - visuals.Gap, area.Top + visuals.Gap);
        ReadPosition();
        for (int i = 0; i < bitmaps.Length; i++) bitmaps[i] = visuals.Frames[i].GetHbitmap(Color.FromArgb(0));
        animation.Interval = 16;
        animation.Tick += delegate { AdvanceAnimation(); };
        Deactivate += delegate { if (keyPressed) { keyPressed = false; AnimateTo(0); } if (!pressed) LowerToDesktop(); };
        Shown += delegate { SetShellOwner(); PaintFrame(); LowerToDesktop(); };
        FormClosed += delegate
        {
            foreach (IntPtr bitmap in bitmaps) if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            visuals.Dispose();
            SettingsProgram.SetMetric(statusWindow, "Launcher", 0);
            SettingsProgram.SetMetric(statusWindow, "Dragging", 0);
        };
        CreateHandle();
        SetShellOwner();
        SettingsProgram.SetMetric(statusWindow, "Launcher", Handle.ToInt64());
        Show();
        initialized = true;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { snapping = false; animation.Dispose(); }
        base.Dispose(disposing);
    }

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams value = base.CreateParams;
            value.Style |= unchecked((int)0x80000000);
            value.ExStyle |= 0x80000 | 0x80;
            value.Parent = GetShellWindow();
            return value;
        }
    }
    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x21) { message.Result = new IntPtr(1); return; }
        bool desktopChanged = message.Msg == 0x7E || message.Msg == 0x1A;
        bool lostActivation = message.Msg == 0x6 && (message.WParam.ToInt64() & 0xffff) == 0;
        IntPtr activatedWindow = message.LParam;
        if (desktopChanged || lostActivation || message.Msg == 0x1F) CancelSnap();
        base.WndProc(ref message);
        if (lostActivation && initialized) deactivated(activatedWindow);
        if (desktopChanged && visuals != null && IsHandleCreated)
        {
            if (pressed) FinishCapture();
            PlaceFromPreference();
            PaintFrame();
            LowerToDesktop();
        }
    }
    protected override bool IsInputKey(Keys keyData)
    {
        Keys key = keyData & Keys.KeyCode;
        return key == Keys.Enter || key == Keys.Space || key == Keys.Escape || base.IsInputKey(keyData);
    }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        CancelSnap();
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left || pressed) return;
        Activate();
        pressed = true; dragging = false; downScreen = Cursor.Position; downWindow = Location;
        Capture = true; AnimateTo(5);
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!pressed || !Capture) return;
        Point cursor = Cursor.Position;
        int dx = cursor.X - downScreen.X, dy = cursor.Y - downScreen.Y;
        if (!dragging && Math.Sqrt((double)dx * dx + (double)dy * dy) >= 6 * scale) dragging = true;
        if (!dragging) return;
        MoveLauncher(Clamp(new Point(downWindow.X + dx, downWindow.Y + dy)));
        SettingsProgram.SetMetric(statusWindow, "Dragging", 1);
        PaintFrame();
    }
    protected override void OnMouseUp(MouseEventArgs e)
    {
        CancelSnap();
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left || !pressed) return;
        long input = Stopwatch.GetTimestamp();
        bool wasDragging = dragging;
        FinishCapture();
        if (wasDragging) { Snap(); SavePosition(); }
        LowerToDesktop();
        if (!wasDragging) toggle(ButtonAnchor(), input);
    }
    protected override void OnMouseCaptureChanged(EventArgs e)
    {
        base.OnMouseCaptureChanged(e);
        if (pressed && !Capture && !releasing) { FinishCapture(); Snap(false); SavePosition(); LowerToDesktop(); }
    }
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        CancelSnap();
        base.OnMouseWheel(e);
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        CancelSnap();
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space)
        { e.Handled = true; e.SuppressKeyPress = true; if (!keyPressed) { keyPressed = true; AnimateTo(5); } }
        else if (e.KeyCode == Keys.Escape && pressed)
        { FinishCapture(); MoveLauncher(downWindow); PaintFrame(); LowerToDesktop(); e.Handled = true; }
    }
    protected override void OnKeyUp(KeyEventArgs e)
    {
        CancelSnap();
        base.OnKeyUp(e);
        if ((e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) && keyPressed)
        { keyPressed = false; AnimateTo(0); LowerToDesktop(); toggle(ButtonAnchor(), Stopwatch.GetTimestamp()); e.Handled = true; }
    }
    protected override AccessibleObject CreateAccessibilityInstance() { return new LauncherAccessibility(this); }
    private sealed class LauncherAccessibility : ControlAccessibleObject
    {
        private readonly DesktopLauncher launcher;
        internal LauncherAccessibility(DesktopLauncher owner) : base(owner) { launcher = owner; }
        public override string DefaultAction { get { return "Open settings"; } }
        public override AccessibleRole Role { get { return AccessibleRole.PushButton; } }
        public override void DoDefaultAction() { launcher.CancelSnap(); launcher.toggle(launcher.ButtonAnchor(), Stopwatch.GetTimestamp()); }
    }
    private void FinishCapture()
    {
        releasing = true; pressed = false; dragging = false; Capture = false; releasing = false;
        SettingsProgram.SetMetric(statusWindow, "Dragging", 0); AnimateTo(0);
    }
    private Point Clamp(Point value)
    {
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        return new Point(Math.Max(area.Left + visuals.Gap, Math.Min(value.X, area.Right - Width - visuals.Gap)),
            Math.Max(area.Top + visuals.Gap, Math.Min(value.Y, area.Bottom - Height - visuals.Gap)));
    }
    private void Snap(bool animate = true)
    {
        CancelSnap();
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        snappedRight = Left + Width / 2 >= area.Left + area.Width / 2;
        snapTarget = Clamp(new Point(snappedRight ? area.Right - Width - visuals.Gap : area.Left + visuals.Gap, Top));
        normalizedY = Math.Max(0, Math.Min(1, (snapTarget.Y - area.Top - visuals.Gap) / (double)Math.Max(1, area.Height - Height - 2 * visuals.Gap)));
        if (!animate || !ClientAnimationsEnabled() || Location == snapTarget)
        {
            MoveLauncher(snapTarget);
            PaintFrame();
            return;
        }
        snapStart = Location;
        snapStarted = Stopwatch.GetTimestamp();
        snapping = true;
        animation.Start();
    }
    private void CancelSnap()
    {
        snapping = false;
        if (frame == targetFrame) animation.Stop();
    }
    private void AdvanceAnimation()
    {
        frame += Math.Sign(targetFrame - frame);
        if (snapping)
        {
            double elapsed = (Stopwatch.GetTimestamp() - snapStarted) * 1000d / Stopwatch.Frequency;
            MoveLauncher(SettingsGeometry.SnapPosition(snapStart, snapTarget, elapsed));
            if (elapsed >= SettingsGeometry.SnapDurationMilliseconds) snapping = false;
        }
        PaintFrame();
        if (!snapping && frame == targetFrame) animation.Stop();
    }
    private void PlaceFromPreference()
    {
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        MoveLauncher(Clamp(new Point(snappedRight ? area.Right - Width - visuals.Gap : area.Left + visuals.Gap,
            area.Top + visuals.Gap + (int)Math.Round(normalizedY * Math.Max(0, area.Height - Height - 2 * visuals.Gap)))));
    }
    private void MoveLauncher(Point position)
    {
        Location = position;
        if (initialized) moved(ButtonAnchor());
    }
    private Point ButtonAnchor()
    {
        return SettingsGeometry.AnchorAtCenter(Screen.PrimaryScreen.Bounds, Bounds);
    }
    private void AnimateTo(int value)
    {
        targetFrame = value;
        if (!ClientAnimationsEnabled()) { CancelSnap(); animation.Stop(); targetFrame = frame = 0; PaintFrame(); }
        else if (frame != targetFrame) animation.Start();
    }
    private static bool ClientAnimationsEnabled()
    {
        bool enabled;
        return !SystemParametersInfo(0x1042, 0, out enabled, 0) || enabled;
    }
    private void PaintFrame()
    {
        if (!IsHandleCreated || IsDisposed || bitmaps[frame] == IntPtr.Zero) return;
        IntPtr screen = GetDC(IntPtr.Zero), memory = CreateCompatibleDC(screen), old = IntPtr.Zero;
        try
        {
            old = SelectObject(memory, bitmaps[frame]);
            Point destination = Location, origin = Point.Empty;
            Size size = visuals.Size;
            Blend blend = new Blend { Alpha = 255, Format = 1 };
            if (!UpdateLayeredWindow(Handle, screen, ref destination, ref size, memory, ref origin, 0, ref blend, 2))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { if (old != IntPtr.Zero) SelectObject(memory, old); if (memory != IntPtr.Zero) DeleteDC(memory); if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen); }
    }
    private void LowerToDesktop()
    {
        if (!IsHandleCreated || IsDisposed || pressed) return;
        if (companionPanel != IntPtr.Zero && IsWindowVisible(companionPanel))
        {
            PlaceAbove(companionPanel);
            return;
        }
        IntPtr shell = GetShellWindow();
        if (shell == IntPtr.Zero) return;
        IntPtr desktop = shell;
        EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            if (FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return true;
            desktop = window;
            return false;
        }, IntPtr.Zero);
        PlaceAbove(desktop);
    }
    internal void RestoreStack() { LowerToDesktop(); }
    private void PlaceAbove(IntPtr window)
    {
        IntPtr preceding = GetWindow(window, 3);
        if (preceding != Handle) SetWindowPos(Handle, preceding, 0, 0, 0, 0, 0x1 | 0x2 | 0x10 | 0x200);
    }
    private void SetShellOwner()
    {
        IntPtr shell = GetShellWindow();
        if (shell == IntPtr.Zero) throw new SettingsFailure("The Windows desktop is not ready. Reopen wallpaper settings shortly.");
        // GWLP_HWNDPARENT changes the owner of a WS_POPUP; it does not reparent a child window or reset DPI awareness.
        SetWindowLongPtr(Handle, -8, shell);
        if (GetWindow(Handle, 4) != shell) throw new SettingsFailure("The desktop settings button could not attach to the Windows desktop.");
    }
    private void ReadPosition()
    {
        try
        {
            Dictionary<string, object> saved = SettingsData.ObjectValue(SettingsData.ReadJson(positionFile));
            object right, value; double y;
            if (!saved.TryGetValue("right", out right) || !(right is bool) || !saved.TryGetValue("y", out value)
                || !SettingsData.NumberValue(value, out y) || y < 0 || y > 1) return;
            snappedRight = (bool)right;
            normalizedY = y;
            PlaceFromPreference();
        }
        catch (Exception) { }
    }
    private void SavePosition()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(positionFile));
            string temporary = positionFile + ".tmp";
            foreach (string file in new string[] { positionFile, temporary })
                if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) return;
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(new
            {
                right = snappedRight,
                y = normalizedY
            }));
            if (File.Exists(positionFile)) File.Replace(temporary, positionFile, null);
            else File.Move(temporary, positionFile);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

internal static class SettingsGeometry
{
    internal const int CoordinateScale = 1000000;
    internal const int SnapDurationMilliseconds = 90;
    internal static readonly Point DefaultAnchor = new Point(980000, 40000);

    internal static bool TryParseUri(string scheme, string value, out Point anchor)
    {
        anchor = DefaultAnchor;
        if (scheme == null || !Regex.IsMatch(scheme, @"^[a-z][a-z0-9-]{1,63}:\z")
            || value == null || value.Length > 256 || !value.StartsWith(scheme, StringComparison.OrdinalIgnoreCase)) return false;
        string action = value.Substring(scheme.Length);
        if (action.Length == 0) return true;
        Match match = Regex.Match(action, @"^open\?x=([01](?:\.[0-9]{1,20})?)&y=([01](?:\.[0-9]{1,20})?)\z");
        if (!match.Success) return false;
        double x, y;
        if (!Double.TryParse(match.Groups[1].Value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out x)
            || !Double.TryParse(match.Groups[2].Value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out y)
            || x < 0 || x > 1 || y < 0 || y > 1 || Double.IsNaN(x) || Double.IsNaN(y)) return false;
        anchor = new Point((int)Math.Round(x * CoordinateScale), (int)Math.Round(y * CoordinateScale));
        return true;
    }

    internal static Point Position(Rectangle screen, Rectangle workArea, Size panel, Point anchor, int gap)
    {
        if (anchor.X < 0 || anchor.X > CoordinateScale || anchor.Y < 0 || anchor.Y > CoordinateScale)
            throw new SettingsFailure("The settings panel position is invalid.");
        int x = screen.Left + (int)Math.Round(screen.Width * (double)anchor.X / CoordinateScale) - panel.Width;
        int y = screen.Top + (int)Math.Round(screen.Height * (double)anchor.Y / CoordinateScale);
        return new Point(Math.Max(workArea.Left + gap, Math.Min(x, workArea.Right - panel.Width - gap)),
            Math.Max(workArea.Top + gap, Math.Min(y, workArea.Bottom - panel.Height - gap)));
    }

    internal static Point AnchorAtCenter(Rectangle screen, Rectangle launcher)
    {
        if (screen.Width <= 0 || screen.Height <= 0) throw new SettingsFailure("The primary display geometry is invalid.");
        return new Point(Math.Max(0, Math.Min(CoordinateScale, (int)Math.Round((launcher.Left + launcher.Width / 2d - screen.Left) / screen.Width * CoordinateScale))),
            Math.Max(0, Math.Min(CoordinateScale, (int)Math.Round((launcher.Top + launcher.Height / 2d - screen.Top) / screen.Height * CoordinateScale))));
    }

    internal static Point SnapPosition(Point start, Point target, double elapsedMilliseconds)
    {
        double remaining = 1 - Math.Max(0, Math.Min(1, elapsedMilliseconds / SnapDurationMilliseconds));
        double progress = 1 - remaining * remaining * remaining;
        return new Point(start.X + (int)Math.Round((target.X - (double)start.X) * progress),
            start.Y + (int)Math.Round((target.Y - (double)start.Y) * progress));
    }

    internal static int SelfTest()
    {
        Point anchor;
        const string scheme = "grid-wallpaper-settings:";
        if (!TryParseUri(scheme, scheme + "open?x=0.95&y=0.1", out anchor) || anchor != new Point(950000, 100000)) return 20;
        if (!TryParseUri(scheme, scheme, out anchor) || anchor != DefaultAnchor) return 21;
        foreach (string invalid in new string[] { "open?x=-0.1&y=0", "open?x=1.1&y=0", "open?x=NaN&y=0", "open?x=Infinity&y=0",
            "open?x=0&y=0&command=quit", "open?x=0&x=0", "open?y=0&x=0", "open?x=0&y=0#fragment", "//open?x=0&y=0",
            "open?x=0%22&y=0", "open?x=0&y=0 --close", "close", "open?x=0&y=0\n", "open?x=.5&y=0" })
            if (TryParseUri(scheme, scheme + invalid, out anchor)) return 22;
        if (TryParseUri(scheme, "https://example.com/open?x=0&y=0", out anchor)) return 23;
        Rectangle screen = new Rectangle(0, 0, 1920, 1200);
        Rectangle area = new Rectangle(0, 0, 1920, 1140);
        Size panel = new Size(450, 875);
        if (Position(screen, area, panel, new Point(950000, 100000), 20) != new Point(1374, 120)) return 24;
        if (Position(screen, area, panel, new Point(0, 0), 20) != new Point(20, 20)) return 25;
        if (Position(screen, area, panel, new Point(CoordinateScale, CoordinateScale), 20) != new Point(1450, 245)) return 26;
        try { Position(screen, area, panel, new Point(-1, 0), 20); return 27; } catch (SettingsFailure) { }
        if (Position(screen, area, panel, AnchorAtCenter(screen, new Rectangle(1840, 20, 60, 60)), 20) != new Point(1420, 50)) return 28;
        if (Position(screen, area, panel, AnchorAtCenter(screen, new Rectangle(1000, 120, 60, 60)), 20) != new Point(580, 150)) return 29;
        if (Position(screen, area, panel, AnchorAtCenter(screen, new Rectangle(20, 800, 60, 60)), 20) != new Point(20, 245)) return 34;
        Rectangle smallerArea = new Rectangle(0, 0, 1600, 600);
        if (Position(screen, smallerArea, new Size(450, 560), AnchorAtCenter(screen, new Rectangle(1520, 500, 60, 60)), 20) != new Point(1100, 20)) return 35;
        Point snapStart = new Point(820, 200), snapTarget = new Point(20, 200);
        if (SnapPosition(snapStart, snapTarget, -1) != snapStart || SnapPosition(snapStart, snapTarget, 0) != snapStart) return 36;
        if (SnapPosition(snapStart, snapTarget, 45) != new Point(120, 200)) return 37;
        if (SnapPosition(snapStart, snapTarget, 90) != snapTarget || SnapPosition(snapStart, snapTarget, 180) != snapTarget) return 38;
        if (SnapPosition(snapTarget, snapStart, 45) != new Point(720, 200)) return 39;
        return 0;
    }
}

internal static class SettingsInteraction
{
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    internal static void MoveWithoutActivation(IntPtr window, Point position)
    {
        SetWindowPos(window, IntPtr.Zero, position.X, position.Y, 0, 0, 0x1 | 0x4 | 0x10 | 0x200);
    }

    internal static bool Contains(IntPtr candidate, IntPtr panel, IntPtr launcher)
    {
        return Contains(candidate, panel, launcher, delegate(IntPtr window) { return GetAncestor(window, 2); },
            delegate(IntPtr window) { return GetWindow(window, 4); });
    }

    private static bool Contains(IntPtr candidate, IntPtr panel, IntPtr launcher, Func<IntPtr, IntPtr> root, Func<IntPtr, IntPtr> owner)
    {
        // Include children and owned popups, but never treat the launcher's shell owner as part of the settings UI.
        for (int depth = 0; candidate != IntPtr.Zero && depth < 16; depth++)
        {
            if (candidate == panel || candidate == launcher) return true;
            IntPtr top = root(candidate);
            if (top == IntPtr.Zero) return false;
            if (top == panel || top == launcher) return true;
            candidate = owner(top);
        }
        return false;
    }

    internal static int SelfTest()
    {
        Func<IntPtr, IntPtr> root = delegate(IntPtr window)
        {
            long id = window.ToInt64();
            return new IntPtr(id == 11 ? 10 : id == 21 ? 20 : id == 31 ? 30 : id == 99 ? 0 : id);
        };
        Func<IntPtr, IntPtr> owner = delegate(IntPtr window)
        {
            long id = window.ToInt64();
            return new IntPtr(id == 12 ? 11 : id == 13 ? 12 : id == 20 ? 30 : id == 40 ? 41 : id == 41 ? 40 : 0);
        };
        foreach (int inside in new int[] { 10, 11, 12, 13, 20, 21 })
            if (!Contains(new IntPtr(inside), new IntPtr(10), new IntPtr(20), root, owner)) return 40;
        foreach (int outside in new int[] { 0, 30, 31, 40, 41, 50, 99 })
            if (Contains(new IntPtr(outside), new IntPtr(10), new IntPtr(20), root, owner)) return 41;
        Console.WriteLine("Settings activation-group validation passed.");
        return 0;
    }
}

internal sealed class SettingsFailure : Exception
{
    public SettingsFailure(string message) : base(message) { }
}

internal sealed class SettingsData
{
    internal string WallpaperDirectory;
    internal string LivelyExecutable;
    internal string LivelyDataDirectory;
    internal string PropertyPath;
    internal int DisplayIndex;
    internal int LivelyProcessId;
    internal Dictionary<string, object> Properties;
    private CultureInfo nativeCulture = CultureInfo.InvariantCulture;

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool GetUserPreferredUILanguages(uint flags, out uint count, StringBuilder languages, ref uint size);

    private static CultureInfo LivelyCulture(Dictionary<string, object> settings)
    {
        object language;
        string name = settings.TryGetValue("Language", out language) ? language as string : null;
        if (String.IsNullOrEmpty(name))
        {
            uint count, size = 0;
            if (GetUserPreferredUILanguages(8, out count, null, ref size) && size > 0 && size < 32768)
            {
                StringBuilder languages = new StringBuilder((int)size);
                if (GetUserPreferredUILanguages(8, out count, languages, ref size)) name = languages.ToString().Split('\0')[0];
            }
            if (String.IsNullOrEmpty(name)) return CultureInfo.InvariantCulture;
        }
        try { return new CultureInfo(name); }
        catch (CultureNotFoundException) { return CultureInfo.CurrentCulture; }
    }

    internal static string NativeSliderArgument(string argument, CultureInfo culture)
    {
        string result = Double.Parse(argument, CultureInfo.InvariantCulture).ToString("0.################", culture);
        if (!Regex.IsMatch(result, "^[0-9]+([.,\u066B][0-9]+)?$"))
            throw new SettingsFailure("The current Lively number format is unsupported. Customize this wallpaper through Lively.");
        return result;
    }

    internal static Dictionary<string, object> ObjectValue(object value)
    {
        Dictionary<string, object> result = value as Dictionary<string, object>;
        if (result == null) throw new SettingsFailure("Wallpaper settings have an invalid format. Rerun setup.");
        return result;
    }

    internal static object ReadJson(string file)
    {
        FileInfo info = new FileInfo(file);
        if (!info.Exists || info.Length > 1024 * 1024 || (info.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new SettingsFailure("Required wallpaper settings are missing or invalid. Apply Grid Wallpaper in Lively and reopen settings.");
        return new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file));
    }

    internal static string RequiredPath(Dictionary<string, object> source, string key)
    {
        object value;
        string path = source.TryGetValue(key, out value) ? value as string : null;
        if (String.IsNullOrWhiteSpace(path) || !Regex.IsMatch(path, @"^[A-Za-z]:[\\/]") || path.IndexOf('"') >= 0)
            throw new SettingsFailure("The installed settings configuration is invalid. Rerun Grid Wallpaper setup.");
        return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
    }

    internal static bool SamePath(string first, string second)
    {
        return String.Equals(Path.GetFullPath(first).TrimEnd('\\'), Path.GetFullPath(second).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    internal static SettingsData Load(string installDirectory)
    {
        Dictionary<string, object> host = ObjectValue(ReadJson(Path.Combine(installDirectory, "windows-host.json")));
        SettingsData data = new SettingsData();
        data.WallpaperDirectory = RequiredPath(host, "WallpaperDirectory");
        data.LivelyExecutable = RequiredPath(host, "LivelyExecutable");
        data.LivelyDataDirectory = RequiredPath(host, "LivelyDataDirectory");
        if (!SamePath(data.WallpaperDirectory, installDirectory) || !File.Exists(data.LivelyExecutable)
            || !String.Equals(Path.GetFileName(data.LivelyExecutable), "Lively.exe", StringComparison.OrdinalIgnoreCase)
            || (new DirectoryInfo(installDirectory).Attributes & FileAttributes.ReparsePoint) != 0)
            throw new SettingsFailure("Run the installed Grid Wallpaper settings window. Rerun setup if it was moved.");
        data.ReloadProperties();
        return data;
    }

    internal void ReloadProperties()
    {
        VerifyPrimary();
        Dictionary<string, object> definitions = ObjectValue(ReadJson(Path.Combine(WallpaperDirectory, "LivelyProperties.json")));
        Dictionary<string, object> saved = ObjectValue(ReadJson(PropertyPath));
        foreach (KeyValuePair<string, object> item in definitions)
        {
            Dictionary<string, object> definition = ObjectValue(item.Value);
            object savedControl, value, normalized;
            string argument;
            if (saved.TryGetValue(item.Key, out savedControl) && savedControl is Dictionary<string, object>
                && ObjectValue(savedControl).TryGetValue("value", out value)
                && ValidateValue(item.Key, definition, value, out normalized, out argument)) definition["value"] = normalized;
        }
        Properties = definitions;
    }

    // Store installations can expose logical AppData paths through native metadata.
    private string NativePath(string path)
    {
        string full = Path.GetFullPath(path);
        string standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lively Wallpaper");
        if (!SamePath(standard, LivelyDataDirectory) && full.StartsWith(standard + "\\", StringComparison.OrdinalIgnoreCase))
            full = Path.Combine(LivelyDataDirectory, full.Substring(standard.Length + 1));
        return full;
    }

    internal void VerifyPrimary()
    {
        Dictionary<string, object> settings = ObjectValue(ReadJson(Path.Combine(LivelyDataDirectory, "Settings.json")));
        nativeCulture = LivelyCulture(settings);
        object arrangement;
        double arrangementValue;
        if (!settings.TryGetValue("WallpaperArrangement", out arrangement) || !NumberValue(arrangement, out arrangementValue) || arrangementValue != 0)
            throw new SettingsFailure("This settings window supports Grid Wallpaper on the primary display in Lively's per-screen layout. Use that layout, or customize through Lively.");
        object browser;
        double browserValue;
        if (!settings.TryGetValue("WebBrowser", out browser) || !NumberValue(browser, out browserValue) || browserValue != 1)
            throw new SettingsFailure("Use Lively's WebView2 player for the desktop settings button, or customize the wallpaper through Lively.");
        IList layouts = ReadJson(Path.Combine(LivelyDataDirectory, "WallpaperLayout.json")) as IList;
        if (layouts == null) throw new SettingsFailure("Apply Grid Wallpaper on the primary display in Lively before opening settings.");
        Dictionary<string, object> primary = null;
        int index = 0;
        foreach (object item in layouts)
        {
            Dictionary<string, object> layout = ObjectValue(item);
            object screenValue, primaryValue, indexValue;
            if (!layout.TryGetValue("LivelyScreen", out screenValue)) continue;
            Dictionary<string, object> screen = ObjectValue(screenValue);
            if (!screen.TryGetValue("IsPrimary", out primaryValue) || !(primaryValue is bool) || !(bool)primaryValue) continue;
            double numericIndex;
            if (primary != null || !screen.TryGetValue("Index", out indexValue) || !NumberValue(indexValue, out numericIndex)
                || numericIndex < 1 || numericIndex > 64 || Math.Truncate(numericIndex) != numericIndex)
                throw new SettingsFailure("Lively's primary display could not be identified. Reapply Grid Wallpaper and reopen settings.");
            primary = layout;
            index = (int)numericIndex;
        }
        object wallpaperPath;
        if (primary == null || !primary.TryGetValue("LivelyInfoPath", out wallpaperPath) || !(wallpaperPath is string)
            || !SamePath(NativePath((string)wallpaperPath), WallpaperDirectory))
            throw new SettingsFailure("Grid Wallpaper must be active on the primary display. Apply it in Lively and reopen settings.");
        string library = NativePath(RequiredPath(settings, "WallpaperDir"));
        if (!SamePath(Path.Combine(library, "wallpapers", "grid-wallpaper"), WallpaperDirectory))
            throw new SettingsFailure("The wallpaper library changed. Rerun Grid Wallpaper setup to reconnect settings.");
        string propertyPath = Path.Combine(library, "SaveData", "wpdata", "grid-wallpaper", index.ToString(CultureInfo.InvariantCulture), "LivelyProperties.json");
        if (PropertyPath != null && (!SamePath(propertyPath, PropertyPath) || index != DisplayIndex))
            throw new SettingsFailure("The active display changed. Close and reopen wallpaper settings.");
        // Match the exact v2.2.1 per-screen property factory path; never choose a directory arbitrarily.
        DirectoryInfo directory = new DirectoryInfo(Path.GetDirectoryName(propertyPath));
        while (directory != null && !SamePath(directory.FullName, library))
        {
            if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new SettingsFailure("The wallpaper settings directory is invalid. Rerun setup.");
            directory = directory.Parent;
        }
        PropertyPath = propertyPath;
        DisplayIndex = index;
        int runningId = 0;
        DateTime oldest = DateTime.MaxValue;
        foreach (Process process in Process.GetProcessesByName("Lively"))
        {
            using (process)
            {
                try
                {
                    if (SamePath(process.MainModule.FileName, LivelyExecutable) && !process.HasExited && process.StartTime < oldest)
                    { runningId = process.Id; oldest = process.StartTime; }
                }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException) { }
            }
        }
        if (runningId == 0 || (LivelyProcessId != 0 && runningId != LivelyProcessId))
            throw new SettingsFailure("Lively is not running or has restarted. Start the wallpaper and reopen settings.");
        LivelyProcessId = runningId;
    }

    internal static bool NumberValue(object value, out double result)
    {
        result = 0;
        if (!(value is int || value is long || value is double || value is decimal || value is float)) return false;
        result = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        return !Double.IsNaN(result) && !Double.IsInfinity(result);
    }

    internal static bool ValidateValue(string name, Dictionary<string, object> definition, object value, out object normalized, out string argument)
    {
        normalized = null; argument = null;
        if (!Regex.IsMatch(name, "^[A-Za-z][A-Za-z0-9]{0,40}$")) return false;
        object typeValue;
        if (!definition.TryGetValue("type", out typeValue)) return false;
        string type = typeValue as string;
        if (type == "checkbox" && value is bool) { normalized = value; argument = (bool)value ? "true" : "false"; return true; }
        if (type == "color" && value is string && Regex.IsMatch((string)value, "^#[0-9a-fA-F]{6}$"))
        { normalized = ((string)value).ToLowerInvariant(); argument = (string)normalized; return true; }
        double number;
        if (!NumberValue(value, out number)) return false;
        if (type == "slider")
        {
            object minimum, maximum;
            double min, max;
            if (!definition.TryGetValue("min", out minimum) || !NumberValue(minimum, out min)
                || !definition.TryGetValue("max", out maximum) || !NumberValue(maximum, out max)
                || min > max || number < min || number > max) return false;
            if ((name == "count" || name == "cellSize") && Math.Truncate(number) != number) return false;
        }
        else if (type == "dropdown")
        {
            object itemsValue;
            IList items = definition.TryGetValue("items", out itemsValue) ? itemsValue as IList : null;
            if (items == null || number < 0 || number >= items.Count || Math.Truncate(number) != number) return false;
        }
        else return false;
        normalized = number;
        argument = number.ToString("0.################", CultureInfo.InvariantCulture);
        return true;
    }

    internal string ValidateChange(string name, object value)
    {
        object definition, normalized;
        string argument;
        if (!Properties.TryGetValue(name, out definition) || !ValidateValue(name, ObjectValue(definition), value, out normalized, out argument))
            throw new SettingsFailure("An unsupported settings value was rejected.");
        return argument;
    }

    internal void SaveChange(string name, string argument)
    {
        VerifyPrimary();
        ProcessStartInfo start = new ProcessStartInfo(LivelyExecutable);
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WorkingDirectory = Path.GetDirectoryName(LivelyExecutable);
        // Names come from the installed schema; arguments contain only validated scalar characters.
        string cliArgument = Object.Equals(ObjectValue(Properties[name])["type"], "slider") ? NativeSliderArgument(argument, nativeCulture) : argument;
        start.Arguments = "setprop --monitor " + DisplayIndex.ToString(CultureInfo.InvariantCulture) + " --property \"" + name + "=" + cliArgument + "\"";
        using (Process process = Process.Start(start))
        {
            if (!process.WaitForExit(5000))
            {
                try { process.Kill(); process.WaitForExit(1000); } catch (InvalidOperationException) { }
                throw new SettingsFailure("Lively did not accept the change in time. Check Lively and try again.");
            }
            if (process.ExitCode != 0) throw new SettingsFailure("Lively could not apply that change. Check the active wallpaper and try again.");
        }
        for (int attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                Dictionary<string, object> saved = ObjectValue(ReadJson(PropertyPath));
                object control, value;
                if (saved.TryGetValue(name, out control) && ObjectValue(control).TryGetValue("value", out value)
                    && ValidateChange(name, value) == argument) return;
            }
            catch (IOException) { }
            catch (ArgumentException) { }
            catch (SettingsFailure) { }
            Thread.Sleep(50);
        }
        throw new SettingsFailure("Lively has not confirmed the saved value. The last change may not have been saved; try again.");
    }

    internal static int SelfTest()
    {
        object normalized; string argument;
        Dictionary<string, object> slider = new Dictionary<string, object> { { "type", "slider" }, { "min", 0 }, { "max", 4 } };
        Dictionary<string, object> color = new Dictionary<string, object> { { "type", "color" } };
        Dictionary<string, object> dropdown = new Dictionary<string, object> { { "type", "dropdown" }, { "items", new object[] { "a", "b" } } };
        if (!ValidateValue("speedScale", slider, 1.7, out normalized, out argument) || argument != "1.7") return 1;
        foreach (object invalid in new object[] { -1, 5, Double.NaN, Double.PositiveInfinity, "1.7", null, true })
            if (ValidateValue("speedScale", slider, invalid, out normalized, out argument)) return 2;
        if (ValidateValue("speed=1 --property", slider, 1, out normalized, out argument)) return 3;
        if (!ValidateValue("bgColor", color, "#A1B2C3", out normalized, out argument) || argument != "#a1b2c3") return 4;
        if (ValidateValue("bgColor", color, "#abc\" --property count=1", out normalized, out argument)) return 5;
        if (ValidateValue("mouseMode", dropdown, 2, out normalized, out argument) || ValidateValue("mouseMode", dropdown, 0.5, out normalized, out argument)) return 6;
        if (!ValidateValue("mouseMode", dropdown, 1, out normalized, out argument)) return 7;
        if (!SamePath(Path.Combine(Path.GetTempPath(), "GridSettings"), Path.Combine(Path.GetTempPath(), "gridsettings") + "\\")) return 8;
        foreach (string invalid in new string[] { "C:relative", "\\relative", @"\\server\share", "http://example.com", "C:\\bad\"path" })
        {
            try { RequiredPath(new Dictionary<string, object> { { "path", invalid } }, "path"); return 9; }
            catch (SettingsFailure) { }
        }
        if (!SamePath(RequiredPath(new Dictionary<string, object> { { "path", Path.GetTempPath() } }, "path"), Path.GetTempPath())) return 10;
        if (NativeSliderArgument("1.7", new CultureInfo("fr-FR")) != "1,7" || NativeSliderArgument("1.7", CultureInfo.InvariantCulture) != "1.7") return 11;
        Uri document = new Uri(@"C:\Grid Wallpaper\grid-wallpaper.html");
        if (document.AbsoluteUri != "file:///C:/Grid%20Wallpaper/grid-wallpaper.html"
            || document.LocalPath != @"C:\Grid Wallpaper\grid-wallpaper.html" || document.Query.Length != 0) return 12;
        return 0;
    }
}

internal sealed class SettingsWindow : Form
{
    private readonly string installDirectory, documentUri;
    private readonly EventWaitHandle shutdown;
    private readonly WebView2 browser = new WebView2();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly Dictionary<string, string> pending = new Dictionary<string, string>();
    private readonly IntPtr statusWindow;
    private readonly System.Windows.Forms.Timer hiddenSuspend = new System.Windows.Forms.Timer();
    private readonly double displayScale;
    private readonly int displayGap;
    private SettingsData data;
    private Process livelyProcess;
    private Point anchor;
    private bool allowVisible, openRequested, everOpened, ready, suspended, suspending, saving, refreshing, refreshAfterSave;
    private bool shuttingDown, shutdownClosing, permitClose, ownerExited, hostChanged, browserFailed, failureNotified;
    private double cornerRadius;
    private long latestRevision;
    private int visibilityEpoch;
    private string saveFailure;
    private Task<bool> savingTask;
    private DesktopLauncher launcher;
    private DomeTelemetry telemetry;
    private long openStarted;
    private int openSequence;
    internal event Action ShutdownCancelled;

    internal SettingsWindow(string installedDirectory, bool warm, Point requestedAnchor, EventWaitHandle shutdownEvent, IntPtr statusHandle, SettingsData loaded)
    {
        installDirectory = installedDirectory;
        openRequested = !warm;
        anchor = requestedAnchor;
        shutdown = shutdownEvent;
        statusWindow = statusHandle;
        data = loaded;
        Text = "Grid Wallpaper Settings";
        FormBorderStyle = FormBorderStyle.None;
        TopMost = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Color.FromArgb(16, 16, 14);
        using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero)) displayScale = graphics.DpiX / 96.0;
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        displayGap = (int)Math.Round(16 * displayScale);
        ClientSize = new Size(Math.Min((int)Math.Round(360 * displayScale), area.Width - displayGap * 2),
            Math.Min((int)Math.Round(700 * displayScale), area.Height - displayGap * 2));
        PositionPanel();
        browser.Dock = DockStyle.Fill;
        browser.DefaultBackgroundColor = BackColor;
        Controls.Add(browser);
        documentUri = new Uri(Path.Combine(installDirectory, "grid-wallpaper.html")).AbsoluteUri;
        timer.Interval = 150;
        timer.Tick += delegate { timer.Stop(); if (!saving && pending.Count > 0) savingTask = SavePending(); };
        hiddenSuspend.Interval = 10000;
        hiddenSuspend.Tick += async delegate { hiddenSuspend.Stop(); await SuspendHidden(); };
        FormClosing += CloseSafely;
        FormClosed += delegate
        {
            if (telemetry != null) { telemetry.Dispose(); telemetry = null; }
            timer.Dispose();
            hiddenSuspend.Dispose();
            if (launcher != null) { launcher.Close(); launcher.Dispose(); }
            if (livelyProcess != null) { livelyProcess.Exited -= LivelyExited; livelyProcess.Dispose(); }
            browser.Dispose();
            if (Region != null) Region.Dispose();
        };
        // Create a discoverable native HWND before asynchronous startup, without showing a blank window.
        CreateHandle();
        try
        {
            telemetry = new DomeTelemetry(installDirectory, ReceiveDomeState);
            telemetry.Start();
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is UnauthorizedAccessException || error is System.Net.HttpListenerException
                || error is ArgumentException || error is InvalidOperationException || error is System.Security.SecurityException)) throw;
            if (telemetry != null) telemetry.Dispose();
            telemetry = null;
        }
        BeginInvoke(new Action(async delegate { await InitializeBrowser(); }));
    }

    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(value && allowVisible); }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        SettingsProgram.SetMetric(statusWindow, "Panel", Handle.ToInt64());
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        SettingsProgram.SetMetric(statusWindow, "Panel", 0);
        base.OnHandleDestroyed(e);
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x10 && shutdown != null && shutdown.WaitOne(0)) shuttingDown = true;
        bool lostActivation = message.Msg == 0x6 && (message.WParam.ToInt64() & 0xffff) == 0;
        IntPtr activatedWindow = message.LParam;
        base.WndProc(ref message);
        if (lostActivation) SurfaceDeactivated(activatedWindow);
        else if (message.Msg == 0x6 && launcher != null && !launcher.IsDisposed) launcher.RestoreStack();
    }

    private void QueueUI(Action action)
    {
        if (IsDisposed || Disposing) return;
        try { BeginInvoke(action); } catch (InvalidOperationException) { }
    }

    private void PositionPanel()
    {
        Screen screen = Screen.PrimaryScreen;
        Size fitted = new Size(Math.Max(1, Math.Min((int)Math.Round(360 * displayScale), screen.WorkingArea.Width - displayGap * 2)),
            Math.Max(1, Math.Min((int)Math.Round(700 * displayScale), screen.WorkingArea.Height - displayGap * 2)));
        if (ClientSize != fitted) { ClientSize = fitted; if (ready) UpdateRegion(); }
        Point position = SettingsGeometry.Position(screen.Bounds, screen.WorkingArea, Size, anchor, displayGap);
        if (IsHandleCreated) SettingsInteraction.MoveWithoutActivation(Handle, position);
        else Location = position;
    }

    private void UpdateRegion()
    {
        System.Drawing.Region previous = Region;
        float diameter = (float)Math.Min(cornerRadius * displayScale * 2, Math.Min(ClientSize.Width, ClientSize.Height));
        if (diameter <= 0) Region = null;
        else
        {
            using (System.Drawing.Drawing2D.GraphicsPath path = new System.Drawing.Drawing2D.GraphicsPath())
            {
                path.AddArc(0, 0, diameter, diameter, 180, 90);
                path.AddArc(ClientSize.Width - diameter, 0, diameter, diameter, 270, 90);
                path.AddArc(ClientSize.Width - diameter, ClientSize.Height - diameter, diameter, diameter, 0, 90);
                path.AddArc(0, ClientSize.Height - diameter, diameter, diameter, 90, 90);
                path.CloseFigure();
                Region = new System.Drawing.Region(path);
                using (System.Drawing.Drawing2D.GraphicsPath border = (System.Drawing.Drawing2D.GraphicsPath)path.Clone())
                using (Pen outline = new Pen(Color.Black, 2))
                {
                    border.Widen(outline);
                    Region.Union(border);
                    Region.Intersect(new Rectangle(Point.Empty, ClientSize));
                }
            }
        }
        if (previous != null) previous.Dispose();
        PublishState();
    }

    private void PublishState()
    {
        SettingsProgram.SetMetric(statusWindow, "TelemetryAvailable", telemetry != null ? 1 : 0);
        SettingsProgram.SetMetric(statusWindow, "TelemetryConnected", telemetry != null && telemetry.Connected ? 1 : 0);
        SettingsProgram.SetMetric(statusWindow, "TelemetryStreaming", telemetry != null && telemetry.Streaming ? 1 : 0);
        if (IsHandleCreated && !IsDisposed)
            SettingsProgram.SetWindowState(statusWindow, ready, suspended, cornerRadius * displayScale, Region != null);
    }

    private bool IsDocument(string uri) { return String.Equals(uri, documentUri, StringComparison.OrdinalIgnoreCase); }

    private async Task InitializeBrowser()
    {
        try
        {
            if (data == null || IsDisposed || shuttingDown) { if (!IsDisposed) RequestShutdown(); return; }
            livelyProcess = Process.GetProcessById(data.LivelyProcessId);
            livelyProcess.EnableRaisingEvents = true;
            livelyProcess.Exited += LivelyExited;
            if (livelyProcess.HasExited) { LivelyExited(livelyProcess, EventArgs.Empty); return; }
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grid Wallpaper", "SettingsWebView2");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
            if (IsDisposed || shuttingDown) return;
            await browser.EnsureCoreWebView2Async(environment);
            if (IsDisposed || shuttingDown) return;
            CoreWebView2 core = browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (!IsDocument(e.Uri)) e.Cancel = true; };
            core.FrameNavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = true; };
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; };
            core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
            core.WebMessageReceived += ReceiveMessage;
            core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e)
            {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited
                    || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited
                    || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) HandleBrowserFailure();
            };
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += RestrictResource;
            core.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (!e.IsSuccess) QueueUI(delegate { StartupFailure("The settings panel could not load. Rerun Grid Wallpaper setup."); });
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync("window.GridSettingsWindow = true;");
            if (!IsDisposed && !shuttingDown) core.Navigate(documentUri);
        }
        catch (Exception error)
        {
            if (!IsDisposed && !shuttingDown)
                StartupFailure(error is SettingsFailure ? error.Message :
                    "The settings window could not initialize. Ensure Microsoft Edge WebView2 Runtime is installed, then rerun setup.");
        }
    }

    private void RestrictResource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        Uri uri;
        bool allowed = false;
        if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri) && uri.IsFile)
        {
            string file = Path.GetFileName(uri.LocalPath);
            allowed = SettingsData.SamePath(Path.GetDirectoryName(uri.LocalPath), installDirectory)
                && (file == "grid-wallpaper.html" || file == "grid-wallpaper.css" || file == "grid-wallpaper.js"
                    || file == "grid-config.js" || file == "grid-settings.js" || file == "grid-native-settings.js" || file == "grid-live-telemetry.js");
        }
        if (!allowed) e.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain");
    }

    private void ReceiveMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (browserFailed || shuttingDown) return;
        try
        {
            if (!IsDocument(e.Source) || !IsDocument(browser.CoreWebView2.Source)) return;
            string json = e.WebMessageAsJson;
            if (json.Length > 65536) return;
            Dictionary<string, object> message = SettingsData.ObjectValue(new JavaScriptSerializer().DeserializeObject(json));
            object kind;
            if (!message.TryGetValue("kind", out kind)) return;
            if (Object.Equals(kind, "ready"))
            {
                if (ready) return;
                object radiusValue;
                double radius;
                if (!message.TryGetValue("radius", out radiusValue) || !SettingsData.NumberValue(radiusValue, out radius)
                    || radius < 0 || radius > 32) throw new SettingsFailure("The settings panel shape is invalid.");
                cornerRadius = radius;
                object launcherValue;
                if (!message.TryGetValue("launcher", out launcherValue)) throw new SettingsFailure("The desktop settings button is missing.");
                LauncherVisuals images = LauncherVisuals.Parse(launcherValue, displayScale);
                try { launcher = new DesktopLauncher(images, displayScale, statusWindow, TogglePanel, FollowLauncher, SurfaceDeactivated, Handle); }
                catch { images.Dispose(); throw; }
                ready = true;
                UpdateRegion();
                Post(new { kind = "init", properties = data.Properties, telemetryAvailable = telemetry != null });
                if (openRequested) ShowPanel();
                else ScheduleSuspend();
            }
            else if (Object.Equals(kind, "close")) HidePanel();
            else if (Object.Equals(kind, "observe-domes") && ready)
            {
                object active;
                if (message.Count != 2 || !message.TryGetValue("active", out active) || !(active is bool)) return;
                if (telemetry != null) telemetry.SetStreaming((bool)active && Visible && openRequested && !shuttingDown);
                PublishState();
            }
            else if (Object.Equals(kind, "interactive"))
            {
                object sequence;
                if (openRequested && Visible && !refreshing && openStarted != 0 && message.TryGetValue("sequence", out sequence)
                    && sequence is int && (int)sequence == openSequence)
                {
                    long micros = (long)((Stopwatch.GetTimestamp() - openStarted) * 1000000d / Stopwatch.Frequency);
                    SettingsProgram.SetMetric(statusWindow, "InteractiveMicros", Math.Max(0, Math.Min(micros, 60000000)));
                    SettingsProgram.SetMetric(statusWindow, "InteractiveSequence", openSequence);
                    openStarted = 0;
                }
            }
            else if (Object.Equals(kind, "change") && ready)
            {
                if (refreshing) throw new SettingsFailure("Settings are still loading. Please try the change again.");
                object changesValue, revisionValue;
                if (!message.TryGetValue("properties", out changesValue) || !message.TryGetValue("revision", out revisionValue)
                    || !(revisionValue is int || revisionValue is long)) return;
                long revision = Convert.ToInt64(revisionValue, CultureInfo.InvariantCulture);
                if (revision <= latestRevision || revision > 9007199254740991L) return;
                Dictionary<string, object> changes = SettingsData.ObjectValue(changesValue);
                if (changes.Count > data.Properties.Count) return;
                Dictionary<string, string> validated = new Dictionary<string, string>();
                foreach (KeyValuePair<string, object> change in changes) validated[change.Key] = data.ValidateChange(change.Key, change.Value);
                foreach (KeyValuePair<string, string> change in validated) pending[change.Key] = change.Value;
                latestRevision = revision;
                if (pending.Count == 0 && !saving) Post(new { kind = "saved", revision = latestRevision });
                else if (!saving) timer.Start();
            }
        }
        catch (Exception error)
        {
            Post(new { kind = "error", message = error is SettingsFailure ? error.Message : "That settings request was rejected. No unsupported value was applied." });
        }
    }

    internal void TogglePanel(Point requestedAnchor, long inputTimestamp)
    {
        anchor = requestedAnchor;
        if (Visible || (openRequested && !ready)) HidePanel();
        else
        {
            openStarted = inputTimestamp; openSequence = openSequence == Int32.MaxValue ? 1 : openSequence + 1;
            SettingsProgram.SetMetric(statusWindow, "OpenSequence", openSequence);
            SettingsProgram.SetMetric(statusWindow, "InteractiveSequence", 0);
            SettingsProgram.SetMetric(statusWindow, "InteractiveMicros", 0);
            OpenPanel();
        }
    }

    private void FollowLauncher(Point requestedAnchor)
    {
        anchor = requestedAnchor;
        if (Visible && openRequested && ready && !shuttingDown && !browserFailed) PositionPanel();
    }

    private void ReceiveDomeState(Dictionary<string, object> state)
    {
        QueueUI(delegate
        {
            PublishState();
            if (ready && Visible && openRequested && !browserFailed && !shuttingDown)
                Post(new { kind = "dome-state", state = state });
        });
    }

    private void SurfaceDeactivated(IntPtr activatedWindow)
    {
        if (!Visible || !openRequested || shuttingDown || IsDisposed) return;
        IntPtr launcherWindow = launcher == null || launcher.IsDisposed ? IntPtr.Zero : launcher.Handle;
        if (SettingsInteraction.Contains(activatedWindow, Handle, launcherWindow)) return;
        int epoch = visibilityEpoch;
        // Deactivation is delivered before activation on the same input queue. Check once after that transition settles.
        QueueUI(delegate
        {
            if (!Visible || !openRequested || shuttingDown || epoch != visibilityEpoch) return;
            IntPtr currentLauncher = launcher == null || launcher.IsDisposed ? IntPtr.Zero : launcher.Handle;
            if (!SettingsInteraction.Contains(SettingsInteraction.GetForegroundWindow(), Handle, currentLauncher)) HidePanel();
        });
    }

    internal void StopForInstaller() { RequestShutdown(); }
    internal void StopForWallpaperChange() { hostChanged = true; RetireSurface(); RequestShutdown(); }
    private void RetireSurface()
    {
        if (telemetry != null) { telemetry.Dispose(); telemetry = null; }
        if (launcher != null) launcher.Hide();
        openRequested = false;
        openStarted = 0;
        Post(new { kind = "hidden" });
        browser.Visible = false;
        allowVisible = false;
        Hide();
    }

    private async void OpenPanel()
    {
        if (shuttingDown || browserFailed) return;
        openRequested = true;
        if (!ready) return;
        if (saving || pending.Count > 0) { refreshAfterSave = true; ShowPanel(); }
        else
        {
            Task refresh = RefreshNativeProperties();
            ShowPanel();
            await refresh;
        }
    }

    private void ShowPanel()
    {
        if (!ready || shuttingDown || browserFailed) return;
        try
        {
            visibilityEpoch++;
            hiddenSuspend.Stop();
            browser.Visible = true;
            browser.CoreWebView2.Resume();
            suspended = false;
            PositionPanel();
            allowVisible = true;
            Show();
            Activate();
            SettingsProgram.SetForegroundWindow(Handle);
            if (launcher != null && !launcher.IsDisposed) launcher.RestoreStack();
            everOpened = true;
            PublishState();
            if (openSequence > 0) Post(new { kind = "shown", sequence = openSequence });
        }
        catch (COMException) { HandleBrowserFailure(); }
        catch (InvalidOperationException) { HandleBrowserFailure(); }
    }

    private void HidePanel()
    {
        if (telemetry != null) telemetry.SetStreaming(false);
        visibilityEpoch++;
        openRequested = false;
        openStarted = 0;
        allowVisible = false;
        Post(new { kind = "hidden" });
        browser.Visible = false;
        Hide();
        if (launcher != null && !launcher.IsDisposed) launcher.RestoreStack();
        if (shuttingDown) return;
        if (!saving && pending.Count > 0) { timer.Stop(); savingTask = SavePending(); }
        else if (!saving) ScheduleSuspend();
    }

    private async Task RefreshNativeProperties()
    {
        if (refreshing || !ready || shuttingDown || !openRequested) return;
        if (saving || pending.Count > 0) { refreshAfterSave = true; return; }
        refreshAfterSave = false;
        refreshing = true;
        browser.Enabled = false;
        Post(new { kind = "loading" });
        try
        {
            await Task.Run(delegate { data.ReloadProperties(); });
            if (!IsDisposed && !shuttingDown) Post(new { kind = "init", properties = data.Properties, telemetryAvailable = telemetry != null });
        }
        catch (Exception error)
        {
            ShowSaveFailure(error is SettingsFailure ? error.Message : "The saved settings could not be refreshed. Check Lively and reopen the panel.");
        }
        finally
        {
            refreshing = false;
            if (!IsDisposed) browser.Enabled = true;
            if (!IsDisposed && !openRequested) ScheduleSuspend();
        }
    }

    private async Task<bool> SavePending()
    {
        saving = true;
        timer.Stop();
        bool success = false;
        try
        {
            while (pending.Count > 0)
            {
                KeyValuePair<string, string> next = default(KeyValuePair<string, string>);
                foreach (KeyValuePair<string, string> item in pending) { next = item; break; }
                pending.Remove(next.Key);
                await Task.Run(delegate { data.SaveChange(next.Key, next.Value); });
            }
            saveFailure = null;
            Post(new { kind = "saved", revision = latestRevision });
            success = true;
            return true;
        }
        catch (Exception error)
        {
            pending.Clear();
            saveFailure = error is SettingsFailure ? error.Message : "Lively could not save the last change. Check that the wallpaper is active and try again.";
            if (!shuttingDown) ShowSaveFailure(saveFailure);
            return false;
        }
        finally
        {
            saving = false;
            if (!IsDisposed && !shuttingDown)
            {
                if (success && refreshAfterSave && openRequested) QueueUI(async delegate { await RefreshNativeProperties(); });
                else if (!openRequested) ScheduleSuspend();
            }
        }
    }

    private bool CanSuspend()
    {
        return !IsDisposed && ready && !openRequested && !Visible && !saving && !refreshing && pending.Count == 0 && !shuttingDown && !browserFailed;
    }

    private void ScheduleSuspend()
    {
        if (!CanSuspend()) return;
        hiddenSuspend.Stop();
        hiddenSuspend.Start();
    }

    private async Task SuspendHidden()
    {
        if (suspending || !CanSuspend()) return;
        suspending = true;
        int epoch = visibilityEpoch;
        try
        {
            browser.Visible = false;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                if (!CanSuspend() || epoch != visibilityEpoch) return;
                try
                {
                    if (!browser.CoreWebView2.IsSuspended) await browser.CoreWebView2.TrySuspendAsync();
                    if (IsDisposed || shuttingDown) return;
                    if (openRequested || Visible) { browser.CoreWebView2.Resume(); suspended = false; }
                    else suspended = browser.CoreWebView2.IsSuspended;
                    PublishState();
                    if (suspended || epoch != visibilityEpoch) return;
                }
                catch (COMException) { }
                catch (InvalidOperationException) { }
                if (attempt < 2) await Task.Delay(100);
            }
        }
        finally
        {
            suspending = false;
            if (epoch != visibilityEpoch && CanSuspend() && !suspended) ScheduleSuspend();
        }
    }

    private void LivelyExited(object sender, EventArgs e)
    {
        QueueUI(delegate { ownerExited = true; RetireSurface(); RequestShutdown(); });
    }

    private void RequestShutdown()
    {
        if (IsDisposed || shuttingDown) return;
        if (telemetry != null) telemetry.SetStreaming(false);
        shuttingDown = true;
        Close();
    }

    private async void CloseSafely(object sender, FormClosingEventArgs e)
    {
        if (permitClose) return;
        if (e.CloseReason == CloseReason.WindowsShutDown)
        {
            shuttingDown = true;
            permitClose = true;
            timer.Stop();
            shutdown.Set();
            e.Cancel = false;
            return;
        }
        if (e.CloseReason == CloseReason.ApplicationExitCall) { shuttingDown = true; shutdown.Set(); }
        e.Cancel = true;
        if (!shuttingDown) { HidePanel(); return; }
        if (shutdownClosing) return;
        shutdownClosing = true;
        if (telemetry != null) telemetry.SetStreaming(false);
        timer.Stop();
        Post(new { kind = "closing" });
        bool success = saving && savingTask != null ? await savingTask : true;
        if (success && pending.Count > 0) success = await SavePending();
        if (!success && !ownerExited && !hostChanged && !browserFailed)
        {
            shuttingDown = false;
            shutdownClosing = false;
            shutdown.Reset();
            ShowSaveFailure(saveFailure);
            if (ShutdownCancelled != null) ShutdownCancelled();
            return;
        }
        if (browserFailed && (everOpened || openRequested) && !failureNotified)
        {
            failureNotified = true;
            MessageBox.Show(this, "The settings window stopped responding. Reopen wallpaper settings and check your recent changes.",
                "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        else if (!success && ownerExited && everOpened)
            MessageBox.Show(this, "Lively closed before the last changes could be saved. Reopen the wallpaper and check your settings.",
                "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        else if (!success && hostChanged && everOpened)
            MessageBox.Show(this, "The wallpaper changed before the last edits could be saved. Reapply Grid Wallpaper and check your settings.",
                "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        permitClose = true;
        Close();
    }

    private void ShowSaveFailure(string message)
    {
        if (IsDisposed || shuttingDown) return;
        openRequested = true;
        ShowPanel();
        Post(new { kind = "error", message = message ?? "The last change could not be saved. Check Lively and try again." });
    }

    private void Post(object message)
    {
        if (IsDisposed || browserFailed) return;
        try
        {
            if (browser.CoreWebView2 != null && IsDocument(browser.CoreWebView2.Source))
                browser.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(message));
        }
        catch (COMException) { HandleBrowserFailure(); }
        catch (InvalidOperationException) { HandleBrowserFailure(); }
    }

    private void HandleBrowserFailure()
    {
        if (IsDisposed || browserFailed) return;
        browserFailed = true;
        ready = false;
        PublishState();
        QueueUI(RequestShutdown);
    }

    private void StartupFailure(string message)
    {
        if (IsDisposed || shuttingDown) return;
        if (openRequested || everOpened)
            MessageBox.Show(message, "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        permitClose = true;
        Close();
    }
}
