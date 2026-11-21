using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

public static class BenchProbe
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32
    {
        public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
        public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
        public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Lo, Hi; }

    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint p);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);

    static string Esc(string s)
    {
        if (s == null) return "";
        var b = new StringBuilder();
        foreach (var c in s)
        {
            if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
            else if (c < 32) b.Append(string.Format("\\u{0:x4}", (int)c));
            else b.Append(c);
        }
        return b.ToString();
    }

    static Dictionary<int, int> Parents()
    {
        var map = new Dictionary<int, int>();
        IntPtr snap = CreateToolhelp32Snapshot(2, 0);
        var e = new PROCESSENTRY32(); e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (Process32FirstW(snap, ref e))
        {
            do { map[(int)e.th32ProcessID] = (int)e.th32ParentProcessID; } while (Process32NextW(snap, ref e));
        }
        CloseHandle(snap);
        return map;
    }

    static DateTime Started(int pid)
    {
        try { return Process.GetProcessById(pid).StartTime; } catch { return DateTime.MaxValue; }
    }

    public static List<int> Tree(IEnumerable<int> roots)
    {
        var parents = Parents();
        var set = new HashSet<int>(roots.Where(parents.ContainsKey));
        var starts = new Dictionary<int, DateTime>();
        foreach (var r in set) starts[r] = Started(r);
        bool grew = true;
        while (grew)
        {
            grew = false;
            foreach (var kv in parents)
            {
                if (set.Contains(kv.Key) || !set.Contains(kv.Value) || kv.Key == kv.Value) continue;
                var st = Started(kv.Key);
                if (st < starts[kv.Value]) continue;
                set.Add(kv.Key); starts[kv.Key] = st; grew = true;
            }
        }
        return set.ToList();
    }

    public static string Stats(IEnumerable<int> roots)
    {
        var pids = Tree(roots);
        long ws = 0, priv = 0; double cpu = 0; int n = 0;
        var names = new SortedDictionary<string, int>();
        foreach (var pid in pids)
        {
            try
            {
                var p = Process.GetProcessById(pid);
                ws += p.WorkingSet64; priv += p.PrivateMemorySize64; cpu += p.TotalProcessorTime.TotalMilliseconds; n++;
                var nm = p.ProcessName; names[nm] = names.ContainsKey(nm) ? names[nm] + 1 : 1;
            }
            catch { }
        }
        var nameJson = string.Join(",", names.Select(kv => "\"" + Esc(kv.Key) + "\":" + kv.Value));
        return "{\"pids\":[" + string.Join(",", pids) + "],\"count\":" + n + ",\"workingSet\":" + ws + ",\"private\":" + priv +
               ",\"cpuMs\":" + cpu.ToString("F1", System.Globalization.CultureInfo.InvariantCulture) + ",\"names\":{" + nameJson + "}}";
    }

    static bool Cloaked(IntPtr h)
    {
        int v; return DwmGetWindowAttribute(h, 14, out v, 4) == 0 && v != 0;
    }

    static List<IntPtr> TopWindows(HashSet<int> pids)
    {
        var list = new List<IntPtr>();
        EnumWindows((h, l) =>
        {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pids.Contains((int)pid) && IsWindowVisible(h) && !IsIconic(h) && !Cloaked(h)) list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static string Windows(IEnumerable<int> roots)
    {
        var pids = new HashSet<int>(Tree(roots));
        var parts = new List<string>();
        foreach (var h in TopWindows(pids))
        {
            RECT r; GetWindowRect(h, out r);
            var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512);
            uint pid; GetWindowThreadProcessId(h, out pid);
            int w = r.R - r.L, hh = r.B - r.T;
            if (w < 100 || hh < 100) continue;
            parts.Add("{\"pid\":" + pid + ",\"title\":\"" + Esc(sb.ToString()) + "\",\"w\":" + w + ",\"h\":" + hh + ",\"owned\":" + (GetWindow(h, 4) != IntPtr.Zero ? "true" : "false") + ",\"hwnd\":" + h.ToInt64() + "}");
        }
        return "[" + string.Join(",", parts) + "]";
    }

    public static string SysTimes()
    {
        FILETIME i, k, u; GetSystemTimes(out i, out k, out u);
        Func<FILETIME, ulong> v = f => ((ulong)f.Hi << 32) | f.Lo;
        return "{\"idle\":" + v(i) + ",\"kernel\":" + v(k) + ",\"user\":" + v(u) + "}";
    }

    public static string TopCpu(int ms)
    {
        var a = new Dictionary<int, Tuple<string, double>>();
        foreach (var p in Process.GetProcesses()) { try { a[p.Id] = Tuple.Create(p.ProcessName, p.TotalProcessorTime.TotalMilliseconds); } catch { } }
        System.Threading.Thread.Sleep(ms);
        var agg = new Dictionary<string, double>();
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                Tuple<string, double> prev; if (!a.TryGetValue(p.Id, out prev)) continue;
                double d = p.TotalProcessorTime.TotalMilliseconds - prev.Item2;
                agg[p.ProcessName] = (agg.ContainsKey(p.ProcessName) ? agg[p.ProcessName] : 0) + d;
            }
            catch { }
        }
        var top = agg.Where(kv => kv.Key != "Idle").OrderByDescending(kv => kv.Value).Take(8)
            .Select(kv => "{\"name\":\"" + Esc(kv.Key) + "\",\"corePct\":" + (kv.Value * 100.0 / ms).ToString("F1", System.Globalization.CultureInfo.InvariantCulture) + "}");
        return "[" + string.Join(",", top) + "]";
    }

    public static string Shot(IEnumerable<int> roots, string path)
    {
        var pids = new HashSet<int>(Tree(roots));
        var wins = TopWindows(pids);
        if (wins.Count == 0) return "{\"ok\":false}";
        IntPtr h = wins.OrderByDescending(x => { RECT r; GetWindowRect(x, out r); return (long)(r.R - r.L) * (r.B - r.T); }).First();
        RECT rc; GetWindowRect(h, out rc);
        using (var bmp = new Bitmap(Math.Max(1, rc.R - rc.L), Math.Max(1, rc.B - rc.T)))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                IntPtr dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc);
            }
            bmp.Save(path, ImageFormat.Png);
        }
        return "{\"ok\":true}";
    }

    public static string ShotWin(long hwnd, string path)
    {
        IntPtr h = new IntPtr(hwnd);
        RECT rc; GetWindowRect(h, out rc);
        using (var bmp = new Bitmap(Math.Max(1, rc.R - rc.L), Math.Max(1, rc.B - rc.T)))
        {
            using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
            bmp.Save(path, ImageFormat.Png);
        }
        return "{\"ok\":true}";
    }

    public static string UiaDumpWin(long hwnd)
    {
        var parts = new List<string>();
        var w = AutomationElement.FromHandle(new IntPtr(hwnd));
        foreach (AutomationElement e in w.FindAll(TreeScope.Descendants, Condition.TrueCondition))
        {
            if (parts.Count > 300) break;
            try { var ci = e.Current; if (ci.IsOffscreen) continue; parts.Add("{\"type\":\"" + Esc(ci.ControlType.ProgrammaticName) + "\",\"name\":\"" + Esc(ci.Name) + "\"}"); } catch { }
        }
        return "[" + string.Join(",", parts) + "]";
    }

    static IEnumerable<AutomationElement> UiaWindows(IEnumerable<int> roots)
    {
        var pids = Tree(roots);
        var res = new List<AutomationElement>();
        foreach (var pid in pids)
        {
            try
            {
                var c = new PropertyCondition(AutomationElement.ProcessIdProperty, pid);
                foreach (AutomationElement w in AutomationElement.RootElement.FindAll(TreeScope.Children, c)) res.Add(w);
            }
            catch { }
        }
        return res;
    }

    public static string UiaDump(IEnumerable<int> roots)
    {
        var parts = new List<string>();
        foreach (var w in UiaWindows(roots))
        {
            try
            {
                foreach (AutomationElement e in w.FindAll(TreeScope.Subtree, Condition.TrueCondition))
                {
                    var ci = e.Current;
                    if (parts.Count > 600) break;
                    parts.Add("{\"win\":\"" + Esc(w.Current.Name) + "\",\"type\":\"" + Esc(ci.ControlType.ProgrammaticName) + "\",\"name\":\"" + Esc(ci.Name) +
                              "\",\"id\":\"" + Esc(ci.AutomationId) + "\",\"enabled\":" + (ci.IsEnabled ? "true" : "false") + "}");
                }
            }
            catch { }
        }
        return "[" + string.Join(",", parts) + "]";
    }

    static AutomationElement FindButton(AutomationElement root, string name, int depth)
    {
        var level = new List<AutomationElement> { root };
        var skip = new[] { ControlType.List, ControlType.Tree, ControlType.DataGrid, ControlType.Table, ControlType.Document, ControlType.Tab };
        for (int d = 0; d < depth && level.Count > 0; d++)
        {
            var next = new List<AutomationElement>();
            foreach (var el in level)
            {
                AutomationElementCollection kids;
                try { kids = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { continue; }
                foreach (AutomationElement k in kids)
                {
                    try
                    {
                        var c = k.Current;
                        if (c.ControlType == ControlType.Button && c.Name == name && c.IsEnabled && !c.IsOffscreen) return k;
                        if (!skip.Contains(c.ControlType) && !c.IsOffscreen) next.Add(k);
                    }
                    catch { }
                }
            }
            level = next;
        }
        return null;
    }

    public static string UiaClick(IEnumerable<int> roots, string window, string name)
    {
        var pids = new HashSet<int>(Tree(roots));
        var wins = TopWindows(pids);
        wins.Sort((a, b) => (GetWindow(b, 4) != IntPtr.Zero).CompareTo(GetWindow(a, 4) != IntPtr.Zero));
        foreach (var h in wins)
        {
            try
            {
                var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512);
                if (window.Length > 0 && sb.ToString().IndexOf(window, StringComparison.OrdinalIgnoreCase) < 0) continue;
                var b = FindButton(AutomationElement.FromHandle(h), name, 6);
                if (b == null) continue;
                object pat;
                if (b.TryGetCurrentPattern(InvokePattern.Pattern, out pat)) { ((InvokePattern)pat).Invoke(); return "{\"ok\":true,\"window\":\"" + Esc(sb.ToString()) + "\"}"; }
            }
            catch { }
        }
        return "{\"ok\":false}";
    }

    public static string UiaTitles(IEnumerable<int> roots)
    {
        var parts = UiaWindows(roots).Select(w => { try { return "\"" + Esc(w.Current.Name) + "\""; } catch { return "\"\""; } });
        return "[" + string.Join(",", parts) + "]";
    }

    static int[] Pids(string s)
    {
        return s.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
    }

    public static string Handle(string line)
    {
        var a = line.Split('\t');
        try
        {
            switch (a[0])
            {
                case "stats": return Stats(Pids(a[1]));
                case "windows": return Windows(Pids(a[1]));
                case "sys": return SysTimes();
                case "topcpu": return TopCpu(int.Parse(a[1]));
                case "shot": return Shot(Pids(a[1]), a[2]);
                case "shotwin": return ShotWin(long.Parse(a[1]), a[2]);
                case "uia-dumpwin": return UiaDumpWin(long.Parse(a[1]));
                case "uia-dump": return UiaDump(Pids(a[1]));
                case "uia-click": return UiaClick(Pids(a[1]), a[2], a[3]);
                case "uia-titles": return UiaTitles(Pids(a[1]));
                case "ping": return "{\"ok\":true}";
            }
            return "{\"error\":\"unknown\"}";
        }
        catch (Exception e) { return "{\"error\":\"" + Esc(e.Message) + "\"}"; }
    }
}
