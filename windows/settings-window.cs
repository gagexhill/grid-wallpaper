// A temporary native window for the repository's existing HTML settings panel.
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
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetProp(IntPtr window, string name);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool SetProp(IntPtr window, string name, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr RemoveProp(IntPtr window, string name);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] internal static extern bool ReleaseCapture();
    [DllImport("user32.dll")] internal static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SettingsData.SelfTest();
        string executable = Path.GetFullPath(Application.ExecutablePath);
        if (args.Length == 1 && args[0] == "--close") return CloseExisting(executable);
        if (args.Length != 0) return 2;
        string id;
        using (SHA256 hash = SHA256.Create())
            id = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(executable.ToUpperInvariant()))).Replace("-", "");
        bool created;
        using (Mutex singleton = new Mutex(true, "Local\\GridWallpaperSettings-" + id, out created))
        {
            if (!created)
            {
                for (int attempt = 0; attempt < 20; attempt++)
                {
                    foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable)))
                    {
                        using (process)
                        {
                            try
                            {
                                if (process.Id != CurrentProcessId && SettingsData.SamePath(process.MainModule.FileName, executable))
                                {
                                    IntPtr window = FindSettingsWindow(process.Id);
                                    if (window != IntPtr.Zero)
                                    {
                                        ShowWindow(window, 9);
                                        SetForegroundWindow(window);
                                        return 0;
                                    }
                                }
                            }
                            catch (System.ComponentModel.Win32Exception) { }
                            catch (InvalidOperationException) { }
                        }
                    }
                    Thread.Sleep(100);
                }
                return 0;
            }
            try
            {
                SetProcessDPIAware();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                SettingsData data = SettingsData.Load(Path.GetDirectoryName(executable));
                Application.Run(new SettingsWindow(data));
                return 0;
            }
            catch (Exception error)
            {
                string message = error is SettingsFailure ? error.Message
                    : "The settings window could not start. Rerun Grid Wallpaper setup and check that Microsoft Edge WebView2 Runtime is installed.";
                MessageBox.Show(message, "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
            finally { singleton.ReleaseMutex(); }
        }
    }

    private static readonly int CurrentProcessId = Process.GetCurrentProcess().Id;

    internal static void MarkWindow(IntPtr window) { SetProp(window, WindowMarker, new IntPtr(1)); }
    internal static void UnmarkWindow(IntPtr window) { RemoveProp(window, WindowMarker); }

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

    private static int CloseExisting(string executable)
    {
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

    private static string RequiredPath(Dictionary<string, object> source, string key)
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
        data.Properties = ObjectValue(ReadJson(Path.Combine(installDirectory, "LivelyProperties.json")));
        data.VerifyPrimary();
        Dictionary<string, object> saved = ObjectValue(ReadJson(data.PropertyPath));
        foreach (KeyValuePair<string, object> item in data.Properties)
        {
            Dictionary<string, object> definition = ObjectValue(item.Value);
            object savedControl, value, normalized;
            string argument;
            if (saved.TryGetValue(item.Key, out savedControl) && savedControl is Dictionary<string, object>
                && ObjectValue(savedControl).TryGetValue("value", out value)
                && ValidateValue(item.Key, definition, value, out normalized, out argument)) definition["value"] = normalized;
        }
        return data;
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
        bool running = false;
        foreach (Process process in Process.GetProcessesByName("Lively"))
        {
            using (process)
            {
                try { if (SamePath(process.MainModule.FileName, LivelyExecutable) && !process.HasExited) running = true; }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException) { }
            }
        }
        if (!running) throw new SettingsFailure("Lively is not running. Start the wallpaper and reopen settings.");
    }

    private static bool NumberValue(object value, out double result)
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
        Uri document = new Uri("file:///C:/Grid%20Wallpaper/grid-wallpaper.html?settings-window");
        if (document.LocalPath != @"C:\Grid Wallpaper\grid-wallpaper.html" || document.Query != "?settings-window") return 12;
        return 0;
    }
}

internal sealed class SettingsWindow : Form
{
    private readonly SettingsData data;
    private readonly WebView2 browser = new WebView2();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly Dictionary<string, string> pending = new Dictionary<string, string>();
    private readonly string documentUri;
    private bool ready, closing, permitClose, saving, browserFailed, failureNotified;
    private long latestRevision;
    private Task<bool> savingTask;

    internal SettingsWindow(SettingsData settings)
    {
        data = settings;
        Text = "Grid Wallpaper Settings";
        FormBorderStyle = FormBorderStyle.None;
        TopMost = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Color.FromArgb(16, 16, 14);
        double scale;
        using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero)) scale = graphics.DpiX / 96.0;
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        int gap = (int)Math.Round(16 * scale);
        ClientSize = new Size(Math.Min((int)Math.Round(360 * scale), area.Width - gap * 2), Math.Min((int)Math.Round(700 * scale), area.Height - gap * 2));
        Location = new Point(area.Right - Width - gap, area.Top + gap);
        browser.Dock = DockStyle.Fill;
        browser.DefaultBackgroundColor = BackColor;
        Controls.Add(browser);
        documentUri = new Uri(Path.Combine(data.WallpaperDirectory, "grid-wallpaper.html")).AbsoluteUri;
        timer.Interval = 150;
        timer.Tick += delegate { if (!saving && pending.Count > 0) savingTask = SavePending(); };
        Shown += async delegate { await InitializeBrowser(); };
        FormClosing += CloseSafely;
        FormClosed += delegate { timer.Dispose(); browser.Dispose(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        SettingsProgram.MarkWindow(Handle);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        SettingsProgram.UnmarkWindow(Handle);
        base.OnHandleDestroyed(e);
    }

    private bool IsDocument(string uri) { return String.Equals(uri, documentUri, StringComparison.OrdinalIgnoreCase); }

    private async Task InitializeBrowser()
    {
        try
        {
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grid Wallpaper", "SettingsWebView2");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
            if (IsDisposed) return;
            await browser.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
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
                if (!e.IsSuccess) { ShowFailure("The settings panel could not load. Rerun Grid Wallpaper setup."); }
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync("window.GridSettingsWindow = true;");
            core.Navigate(documentUri);
            timer.Start();
        }
        catch (Exception)
        {
            if (!IsDisposed) ShowFailure("The settings window could not initialize. Ensure Microsoft Edge WebView2 Runtime is installed, then rerun setup.");
        }
    }

    private void RestrictResource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        Uri uri;
        bool allowed = false;
        if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri) && uri.IsFile)
        {
            string file = Path.GetFileName(uri.LocalPath);
            allowed = SettingsData.SamePath(Path.GetDirectoryName(uri.LocalPath), data.WallpaperDirectory)
                && (file == "grid-wallpaper.html" || file == "grid-wallpaper.css" || file == "grid-wallpaper.js" || file == "grid-config.js" || file == "grid-settings.js" || file == "grid-native-settings.js");
        }
        if (!allowed) e.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain");
    }

    private void ReceiveMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (browserFailed || closing) return;
        try
        {
            if (!IsDocument(e.Source) || !IsDocument(browser.CoreWebView2.Source)) return;
            string json = e.WebMessageAsJson;
            if (json.Length > 32768) return;
            Dictionary<string, object> message = SettingsData.ObjectValue(new JavaScriptSerializer().DeserializeObject(json));
            object kind;
            if (!message.TryGetValue("kind", out kind)) return;
            if (Object.Equals(kind, "ready"))
            {
                ready = true;
                Post(new { kind = "init", properties = data.Properties });
            }
            else if (Object.Equals(kind, "close")) Close();
            else if (Object.Equals(kind, "drag"))
            {
                SettingsProgram.ReleaseCapture();
                SettingsProgram.SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
            }
            else if (Object.Equals(kind, "change") && ready)
            {
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
            }
        }
        catch (Exception) { Post(new { kind = "error", message = "That settings request was rejected. No unsupported value was applied." }); }
    }

    private async Task<bool> SavePending()
    {
        saving = true;
        try
        {
            while (pending.Count > 0)
            {
                KeyValuePair<string, string> next = default(KeyValuePair<string, string>);
                foreach (KeyValuePair<string, string> item in pending) { next = item; break; }
                pending.Remove(next.Key);
                await Task.Run(delegate { data.SaveChange(next.Key, next.Value); });
            }
            Post(new { kind = "saved", revision = latestRevision });
            return true;
        }
        catch (Exception error)
        {
            pending.Clear();
            Post(new { kind = "error", message = error is SettingsFailure ? error.Message : "Lively could not save the last change. Check that the wallpaper is active and try again." });
            return false;
        }
        finally { saving = false; }
    }

    private async void CloseSafely(object sender, FormClosingEventArgs e)
    {
        if (permitClose) return;
        if (!saving && pending.Count == 0) { if (browserFailed) NotifyBrowserFailure(); return; }
        e.Cancel = true;
        if (closing) return;
        Post(new { kind = "closing" });
        closing = true;
        timer.Stop();
        bool success = saving && savingTask != null ? await savingTask : true;
        if (success && pending.Count > 0) success = await SavePending();
        if (browserFailed) { NotifyBrowserFailure(); permitClose = true; Close(); }
        else if (success) { permitClose = true; Close(); }
        else { closing = false; timer.Start(); }
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
        browser.Enabled = false;
        // The normal close path still finishes bounded pending writes before disposing the browser.
        if (!closing) BeginInvoke(new Action(Close));
    }

    private void NotifyBrowserFailure()
    {
        if (failureNotified) return;
        failureNotified = true;
        MessageBox.Show(this, "The settings window stopped responding. Reopen wallpaper settings and check your recent changes.",
            "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private void ShowFailure(string message)
    {
        MessageBox.Show(this, message, "Grid Wallpaper Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        permitClose = true;
        Close();
    }
}
