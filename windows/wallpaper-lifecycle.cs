// Windows owns connected displays; Lively owns wallpaper selection and playback.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class WallpaperDisplay
{
    internal string Id, Name;
    internal int Count;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        internal int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] internal string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string Description;
        internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string Id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string Key;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice result, uint flags);

    internal static WallpaperDisplay Current()
    {
        Screen primary = Screen.PrimaryScreen;
        if (primary == null) throw new SettingsFailure("Windows has not identified the primary display yet.");
        for (uint index = 0; index < 64; index++)
        {
            DisplayDevice device = new DisplayDevice();
            device.Size = Marshal.SizeOf(typeof(DisplayDevice));
            // EDD_GET_DEVICE_INTERFACE_NAME and attached/non-mirroring filtering match Lively 2.2.1.
            if (!EnumDisplayDevices(primary.DeviceName, index, ref device, 1)) break;
            if ((device.Flags & 1) != 0 && (device.Flags & 8) == 0 && !String.IsNullOrWhiteSpace(device.Id))
                return new WallpaperDisplay { Id = device.Id, Name = primary.DeviceName, Count = Screen.AllScreens.Length };
        }
        throw new SettingsFailure("Windows has not identified the primary display yet.");
    }

    internal Dictionary<string, object> Select(IList layouts)
    {
        Dictionary<string, object> selected = null;
        foreach (object item in layouts)
        {
            Dictionary<string, object> layout = SettingsData.ObjectValue(item);
            object value, id;
            if (!layout.TryGetValue("LivelyScreen", out value)) continue;
            Dictionary<string, object> display = SettingsData.ObjectValue(value);
            if (!display.TryGetValue("DeviceId", out id) || !String.Equals(id as string, Id, StringComparison.OrdinalIgnoreCase)) continue;
            if (selected != null) throw new SettingsFailure("Lively has conflicting selections for the current display. Reapply Grid Wallpaper.");
            selected = layout;
        }
        return selected;
    }

    internal bool CanRestore(IList layouts, string wallpaperDirectory, Func<string, string> nativePath)
    {
        if (Count != 1 || layouts == null || layouts.Count == 0 || Select(layouts) != null) return false;
        foreach (object item in layouts)
        {
            Dictionary<string, object> layout = SettingsData.ObjectValue(item);
            object value, path, id, primary, name, index;
            double number;
            if (!layout.TryGetValue("LivelyInfoPath", out path) || !(path is string)
                || !SettingsData.SamePath(nativePath((string)path), wallpaperDirectory)
                || !layout.TryGetValue("LivelyScreen", out value)) return false;
            Dictionary<string, object> display = SettingsData.ObjectValue(value);
            if (!display.TryGetValue("DeviceId", out id) || !SamePanel(id as string, Id)
                || !display.TryGetValue("IsPrimary", out primary) || !Object.Equals(primary, true)
                || !display.TryGetValue("DeviceName", out name) || !Object.Equals(name, Name)
                || !display.TryGetValue("Index", out index) || !SettingsData.NumberValue(index, out number) || number != 1) return false;
        }
        return true;
    }

    private static bool SamePanel(string previous, string current)
    {
        if (String.IsNullOrEmpty(previous) || String.IsNullOrEmpty(current)) return false;
        string[] oldParts = previous.Split('#'), newParts = current.Split('#');
        if (oldParts.Length != 4 || newParts.Length != 4 || oldParts[0] != @"\\?\DISPLAY" || newParts[0] != oldParts[0]) return false;
        int oldUid = oldParts[2].LastIndexOf("&UID", StringComparison.OrdinalIgnoreCase);
        int newUid = newParts[2].LastIndexOf("&UID", StringComparison.OrdinalIgnoreCase);
        return oldUid >= 0 && newUid >= 0
            && String.Equals(oldParts[1], newParts[1], StringComparison.OrdinalIgnoreCase)
            && String.Equals(oldParts[2].Substring(oldUid), newParts[2].Substring(newUid), StringComparison.OrdinalIgnoreCase)
            && String.Equals(oldParts[3], newParts[3], StringComparison.OrdinalIgnoreCase);
    }
}

internal static class WallpaperPlayback
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    internal static string Argument(string commandLine, string name)
    {
        if (String.IsNullOrEmpty(commandLine) || commandLine.Length > 32768) return null;
        int count;
        IntPtr arguments = CommandLineToArgvW(commandLine, out count);
        if (arguments == IntPtr.Zero) return null;
        try
        {
            string found = null;
            for (int i = 1; i < count; i++)
            {
                string argument = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, i * IntPtr.Size));
                if (argument != name) continue;
                if (found != null || ++i >= count) return null;
                found = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, i * IntPtr.Size));
            }
            return found;
        }
        finally { LocalFree(arguments); }
    }

    internal static int Find(SettingsData data, bool requireEmpty)
    {
        int match = 0;
        string expectedExecutable = Path.Combine(Path.GetDirectoryName(data.LivelyExecutable), "plugins", "webview2", "Lively.Player.WebView2.exe");
        string expectedDocument = Path.Combine(data.WallpaperDirectory, "grid-wallpaper.html");
        EnumerationOptions options = new EnumerationOptions { ReturnImmediately = false, Timeout = TimeSpan.FromSeconds(2) };
        using (ManagementObjectSearcher search = new ManagementObjectSearcher("root\\cimv2",
            "SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process WHERE ParentProcessId = "
            + data.LivelyProcessId.ToString(CultureInfo.InvariantCulture), options))
        using (ManagementObjectCollection processes = search.Get())
        {
            foreach (ManagementObject process in processes)
            {
                using (process)
                {
                    // Unknown children, UI activity and other players all suppress automatic recovery.
                    if (requireEmpty) return -1;
                    string executable = process["ExecutablePath"] as string, command = process["CommandLine"] as string;
                    if (String.IsNullOrEmpty(executable) || !SettingsData.SamePath(executable, expectedExecutable)) continue;
                    if (!Matches(command, expectedDocument, data.DisplayId)) continue;
                    if (match != 0) throw new SettingsFailure("Lively has more than one Grid player for the primary display.");
                    match = Convert.ToInt32(process["ProcessId"], CultureInfo.InvariantCulture);
                }
            }
        }
        return match;
    }

    internal static bool Matches(string command, string expectedDocument, string displayId)
    {
        if (!String.Equals(Argument(command, "--wallpaper-display"), displayId, StringComparison.OrdinalIgnoreCase)) return false;
        string document = Argument(command, "--wallpaper-url");
        if (String.IsNullOrEmpty(document) || document.Length < 3 || !Char.IsLetter(document[0]) || document[1] != ':'
            || (document[2] != '\\' && document[2] != '/')) return false;
        try { return SettingsData.SamePath(document, expectedDocument); }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
        catch (PathTooLongException) { return false; }
    }
}

// One bounded opportunity per Lively lifetime; never retry an uncertain CLI submission.
internal sealed class WallpaperStartupRecovery
{
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private string lifetime, initialSnapshot;
    private long observedAt;
    internal int State { get; private set; } // 0 observing, 1 waiting, 2 skipped, 3 submitted, 4 failed

    internal bool ShouldSubmit(string processLifetime, string snapshot, double ageMilliseconds, bool eligible, long now)
    {
        if (lifetime != processLifetime)
        {
            lifetime = processLifetime; initialSnapshot = snapshot; observedAt = now; State = 0;
        }
        if (State >= 2) return false;
        if (!eligible || ageMilliseconds < 0 || ageMilliseconds > 120000 || snapshot != initialSnapshot)
        { State = 2; return false; }
        State = 1;
        if (now - observedAt < 10000) return false;
        State = 3;
        return true;
    }

    internal void Prepare(SettingsData data, CancellationToken cancellation)
    {
        data.VerifyLively();
        using (Process lively = Process.GetProcessById(data.LivelyProcessId))
        {
            string processLifetime = lively.Id.ToString(CultureInfo.InvariantCulture) + ":" + lively.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture);
            if (lifetime == processLifetime && State >= 2) return;
            string settingsPath = Path.Combine(data.LivelyDataDirectory, "Settings.json");
            Dictionary<string, object> settings = SettingsData.ObjectValue(SettingsData.ReadJson(settingsPath));
            try { data.VerifyEnvironment(settings); }
            catch { Claim(processLifetime); ShouldSubmit(processLifetime, "", 0, false, clock.ElapsedMilliseconds); throw; }
            string layoutPath = Path.Combine(data.LivelyDataDirectory, "WallpaperLayout.json");
            IList layouts = SettingsData.ReadJson(layoutPath) as IList;
            WallpaperDisplay display = WallpaperDisplay.Current();
            long layoutWrite = File.GetLastWriteTimeUtc(layoutPath).Ticks;
            long settingsWrite = File.GetLastWriteTimeUtc(settingsPath).Ticks;
            var serializer = new System.Web.Script.Serialization.JavaScriptSerializer();
            string snapshot = display.Id + "|" + layoutWrite.ToString(CultureInfo.InvariantCulture)
                + "|" + settingsWrite.ToString(CultureInfo.InvariantCulture) + "|" + serializer.Serialize(settings) + "|" + serializer.Serialize(layouts);
            bool eligible = display.CanRestore(layouts, data.WallpaperDirectory, data.NativePath)
                && WallpaperPlayback.Find(data, true) == 0;
            if (lifetime != processLifetime && !Claim(processLifetime))
            { lifetime = processLifetime; State = 2; return; }
            if (!ShouldSubmit(processLifetime, snapshot, (DateTime.Now - lively.StartTime).TotalMilliseconds, eligible, clock.ElapsedMilliseconds)) return;
            try
            {
                cancellation.ThrowIfCancellationRequested();
                data.VerifyLively();
                if (WallpaperPlayback.Find(data, true) != 0) { State = 2; return; }
                WallpaperDisplay latestDisplay = WallpaperDisplay.Current();
                if (latestDisplay.Id != display.Id || latestDisplay.Count != 1 || File.GetLastWriteTimeUtc(layoutPath).Ticks != layoutWrite
                    || File.GetLastWriteTimeUtc(settingsPath).Ticks != settingsWrite
                    || serializer.Serialize(SettingsData.ReadJson(settingsPath)) != serializer.Serialize(settings)
                    || serializer.Serialize(SettingsData.ReadJson(layoutPath)) != serializer.Serialize(layouts)) { State = 2; return; }
                cancellation.ThrowIfCancellationRequested();
                // Store installations require Lively's logical library path in CLI commands.
                string commandDirectory = Path.Combine(SettingsData.RequiredPath(settings, "WallpaperDir"), "wallpapers", "grid-wallpaper");
                ProcessStartInfo start = new ProcessStartInfo(data.LivelyExecutable) {
                    UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(data.LivelyExecutable),
                    Arguments = "setwp --file \"" + commandDirectory + "\""
                };
                data.VerifyLively();
                cancellation.ThrowIfCancellationRequested();
                using (Process command = Process.Start(start))
                {
                    if (!command.WaitForExit(5000))
                    {
                        try { command.Kill(); command.WaitForExit(1000); } catch (InvalidOperationException) { }
                        throw new SettingsFailure("Lively did not confirm startup recovery. Reapply Grid Wallpaper in Lively.");
                    }
                    if (command.ExitCode != 0) throw new SettingsFailure("Lively could not restore Grid Wallpaper. Reapply it in Lively.");
                }
            }
            catch { State = 4; throw; }
        }
    }

    private static bool Claim(string processLifetime)
    {
        // Persist the opportunity before waiting/dispatch so helper restarts cannot rearm it.
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grid Wallpaper");
        return ClaimAtDirectory(directory, processLifetime);
    }

    private static bool ClaimAtDirectory(string directory, string processLifetime)
    {
        string marker = Path.Combine(directory, "startup-recovery.json");
        string temporary = Path.Combine(directory, "startup-recovery-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            Directory.CreateDirectory(directory);
            if ((new DirectoryInfo(directory).Attributes & FileAttributes.ReparsePoint) != 0) return false;
            if (File.Exists(marker))
            {
                Dictionary<string, object> saved = SettingsData.ObjectValue(SettingsData.ReadJson(marker));
                object version, previous;
                if (saved.Count != 2 || !saved.TryGetValue("version", out version) || !Object.Equals(version, 1)
                    || !saved.TryGetValue("lifetime", out previous) || !(previous is string)
                    || Object.Equals(previous, processLifetime)) return false;
            }
            string json = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new { version = 1, lifetime = processLifetime });
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)))
            { writer.Write(json); writer.Flush(); stream.Flush(true); }
            if (File.Exists(marker)) File.Replace(temporary, marker, null); else File.Move(temporary, marker);
            return true;
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is UnauthorizedAccessException || error is ArgumentException
                || error is SettingsFailure || error is System.Security.SecurityException)) throw;
            return false;
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    internal static int SelfTest()
    {
        const string oldId = @"\\?\DISPLAY#PANEL123#4&old&0&UID42#{test}";
        const string currentId = @"\\?\DISPLAY#PANEL123#4&new&0&UID42#{test}";
        const string directory = @"C:\Library\wallpapers\grid-wallpaper";
        Func<string, string, Dictionary<string, object>> layout = delegate(string id, string path) {
            return new Dictionary<string, object> { { "LivelyInfoPath", path }, { "LivelyScreen", new Dictionary<string, object> {
                { "DeviceId", id }, { "DeviceName", @"\\.\DISPLAY1" }, { "IsPrimary", true }, { "Index", 1 } } } };
        };
        WallpaperDisplay display = new WallpaperDisplay { Id = currentId, Name = @"\\.\DISPLAY1", Count = 1 };
        Dictionary<string, object> old = layout(oldId, directory), current = layout(currentId, directory);
        if (display.Select(new object[] { old, current }) != current || display.Select(new object[] { current, old }) != current) return 81;
        if (display.Select(new object[] { old }) != null || !display.CanRestore(new object[] { old }, directory, delegate(string path) { return path; })) return 82;
        if (display.CanRestore(new object[] { old, layout(currentId, @"C:\Library\other") }, directory, delegate(string path) { return path; })) return 83;
        if (display.CanRestore(new object[0], directory, delegate(string path) { return path; })) return 84;
        if (display.CanRestore(new object[] { layout(oldId.Replace("PANEL123", "OTHER"), directory) }, directory, delegate(string path) { return path; })) return 85;
        display.Count = 2;
        if (display.CanRestore(new object[] { old }, directory, delegate(string path) { return path; })) return 86;
        display.Count = 1;
        try { display.Select(new object[] { current, current }); return 87; } catch (SettingsFailure) { }
        WallpaperStartupRecovery gate = new WallpaperStartupRecovery();
        if (gate.ShouldSubmit("process1", "saved", 1000, true, 0) || gate.ShouldSubmit("process1", "saved", 5000, true, 9000)
            || !gate.ShouldSubmit("process1", "saved", 11000, true, 10000) || gate.ShouldSubmit("process1", "saved", 12000, true, 20000)) return 88;
        if (gate.ShouldSubmit("process2", "saved", 1000, true, 30000) || gate.ShouldSubmit("process2", "changed", 12000, true, 42000)
            || gate.ShouldSubmit("process2", "saved", 13000, true, 50000)) return 89;
        if (gate.ShouldSubmit("process3", "saved", 130000, true, 60000) || gate.ShouldSubmit("process4", "saved", 1000, false, 70000)
            || gate.ShouldSubmit("process4", "saved", 12000, true, 82000)) return 90;
        if (WallpaperPlayback.Argument("player.exe --wallpaper-url \"C:\\Library with spaces\\grid-wallpaper.html\" --wallpaper-display panel", "--wallpaper-url")
            != @"C:\Library with spaces\grid-wallpaper.html" || WallpaperPlayback.Argument("player.exe --wallpaper-url a --wallpaper-url b", "--wallpaper-url") != null) return 91;
        if (WallpaperPlayback.Matches("player.exe --wallpaper-url https://example.com --wallpaper-display other", directory, "panel")
            || WallpaperPlayback.Matches("player.exe --wallpaper-url https://example.com --wallpaper-display panel", directory, "panel")
            || !WallpaperPlayback.Matches("player.exe --wallpaper-url \"C:\\Library with spaces\\grid-wallpaper.html\" --wallpaper-display panel", @"C:\Library with spaces\grid-wallpaper.html", "panel")) return 92;
        if (display.CanRestore(new object[] { layout(oldId.Replace("UID42", "UID43"), directory) }, directory, delegate(string path) { return path; })
            || display.CanRestore(new object[] { layout(oldId, @"C:\Library\other") }, directory, delegate(string path) { return path; })) return 93;
        string fixture = Path.Combine(Path.GetTempPath(), "grid-startup-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            if (!ClaimAtDirectory(fixture, "process1") || ClaimAtDirectory(fixture, "process1") || !ClaimAtDirectory(fixture, "process2")) return 94;
            File.WriteAllText(Path.Combine(fixture, "startup-recovery.json"), "{}");
            if (ClaimAtDirectory(fixture, "process3")) return 95;
        }
        finally
        {
            if (Directory.Exists(fixture))
            {
                File.Delete(Path.Combine(fixture, "startup-recovery.json"));
                Directory.Delete(fixture);
            }
        }
        Console.WriteLine("Connected-display selection, playback arguments and bounded startup recovery validation passed.");
        return 0;
    }
}
