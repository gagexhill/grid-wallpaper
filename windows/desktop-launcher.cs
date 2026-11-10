using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

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
    private string preferredDisplay;
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
        MoveLauncher(SettingsGeometry.Clamp(Screen.FromPoint(cursor).WorkingArea,
            Size, new Point(downWindow.X + dx, downWindow.Y + dy), visuals.Gap));
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
    private void Snap(bool animate = true)
    {
        CancelSnap();
        Screen screen = Screen.FromPoint(ButtonAnchor());
        Rectangle area = screen.WorkingArea;
        preferredDisplay = WallpaperDisplay.DeviceId(screen);
        snappedRight = Left + Width / 2 >= area.Left + area.Width / 2;
        snapTarget = SettingsGeometry.Clamp(area, Size,
            new Point(snappedRight ? area.Right - Width - visuals.Gap : area.Left + visuals.Gap, Top), visuals.Gap);
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
        Screen screen = Screen.PrimaryScreen;
        if (!String.IsNullOrEmpty(preferredDisplay))
            foreach (Screen candidate in Screen.AllScreens)
            {
                if (!String.Equals(WallpaperDisplay.DeviceId(candidate), preferredDisplay, StringComparison.OrdinalIgnoreCase)) continue;
                screen = candidate;
                break;
            }
        Rectangle area = screen.WorkingArea;
        MoveLauncher(SettingsGeometry.Clamp(area, Size,
            new Point(snappedRight ? area.Right - Width - visuals.Gap : area.Left + visuals.Gap,
                area.Top + visuals.Gap + (int)Math.Round(normalizedY * Math.Max(0, area.Height - Height - 2 * visuals.Gap))),
            visuals.Gap));
    }
    private void MoveLauncher(Point position)
    {
        Location = position;
        if (initialized) moved(ButtonAnchor());
    }
    private Point ButtonAnchor()
    {
        return new Point(Left + Width / 2, Top + Height / 2);
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
        if (!File.Exists(positionFile)) return;
        try
        {
            Dictionary<string, object> saved = SettingsData.ObjectValue(SettingsData.ReadJson(positionFile));
            object right, value; double y;
            if (!saved.TryGetValue("right", out right) || !(right is bool) || !saved.TryGetValue("y", out value)
                || !SettingsData.NumberValue(value, out y) || y < 0 || y > 1) return;
            snappedRight = (bool)right;
            normalizedY = y;
            object display;
            if (saved.TryGetValue("display", out display)) preferredDisplay = display as string;
            PlaceFromPreference();
        }
        catch (Exception error) { Console.Error.WriteLine("Could not read the saved launcher position: " + error.GetType().Name); }
    }
    private void SavePosition()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(positionFile));
            string temporary = positionFile + ".tmp";
            foreach (string file in new string[] { positionFile, temporary })
                if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("The launcher preference path is redirected.");
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(new
            {
                right = snappedRight,
                y = normalizedY,
                display = preferredDisplay
            }));
            if (File.Exists(positionFile)) File.Replace(temporary, positionFile, null);
            else File.Move(temporary, positionFile);
        }
        catch (IOException error) { Console.Error.WriteLine("Could not save the launcher position: " + error.GetType().Name); }
        catch (UnauthorizedAccessException error) { Console.Error.WriteLine("Could not save the launcher position: " + error.GetType().Name); }
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

    internal static Point ScreenPoint(Rectangle screen, Point anchor)
    {
        if (anchor.X < 0 || anchor.X > CoordinateScale || anchor.Y < 0 || anchor.Y > CoordinateScale)
            throw new SettingsFailure("The settings panel position is invalid.");
        int x = screen.Left + (int)Math.Round(screen.Width * (double)anchor.X / CoordinateScale);
        int y = screen.Top + (int)Math.Round(screen.Height * (double)anchor.Y / CoordinateScale);
        return new Point(Math.Min(x, screen.Right - 1), Math.Min(y, screen.Bottom - 1));
    }

    internal static Point Position(Rectangle workArea, Size panel, Point anchor, int gap)
    {
        return Clamp(workArea, panel, new Point(anchor.X - panel.Width, anchor.Y), gap);
    }

    internal static Point Clamp(Rectangle workArea, Size size, Point position, int gap)
    {
        return new Point(Math.Max(workArea.Left + gap, Math.Min(position.X, workArea.Right - size.Width - gap)),
            Math.Max(workArea.Top + gap, Math.Min(position.Y, workArea.Bottom - size.Height - gap)));
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
        if (Position(area, panel, ScreenPoint(screen, new Point(950000, 100000)), 20) != new Point(1374, 120)) return 24;
        if (Position(area, panel, ScreenPoint(screen, Point.Empty), 20) != new Point(20, 20)) return 25;
        if (Position(area, panel, ScreenPoint(screen, new Point(CoordinateScale, CoordinateScale)), 20) != new Point(1450, 245)) return 26;
        try { ScreenPoint(screen, new Point(-1, 0)); return 27; } catch (SettingsFailure) { }
        if (Position(area, panel, new Point(1870, 50), 20) != new Point(1420, 50)) return 28;
        if (Position(area, panel, new Point(1030, 150), 20) != new Point(580, 150)) return 29;
        if (Position(area, panel, new Point(50, 830), 20) != new Point(20, 245)) return 34;
        Rectangle smallerArea = new Rectangle(0, 0, 1600, 600);
        if (Position(smallerArea, new Size(450, 560), new Point(1550, 530), 20) != new Point(1100, 20)) return 35;
        Rectangle leftArea = new Rectangle(-1920, -101, 1920, 1032);
        if (Clamp(leftArea, new Size(60, 60), new Point(-2, -200), 20) != new Point(-80, -81)) return 42;
        if (Position(leftArea, panel, new Point(-730, 10), 20) != new Point(-1180, 10)) return 43;
        Point snapStart = new Point(820, 200), snapTarget = new Point(20, 200);
        if (SnapPosition(snapStart, snapTarget, -1) != snapStart || SnapPosition(snapStart, snapTarget, 0) != snapStart) return 36;
        if (SnapPosition(snapStart, snapTarget, 45) != new Point(120, 200)) return 37;
        if (SnapPosition(snapStart, snapTarget, 90) != snapTarget || SnapPosition(snapStart, snapTarget, 180) != snapTarget) return 38;
        if (SnapPosition(snapTarget, snapStart, 45) != new Point(720, 200)) return 39;
        return 0;
    }
}
