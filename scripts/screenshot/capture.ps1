# Waits for a window whose title matches -TitleLike, resizes it and saves a PNG of it (works while it is covered).
param(
    [Parameter(Mandatory)] [string] $TitleLike,
    [Parameter(Mandatory)] [string] $Out,
    [int] $DelaySeconds = 12,
    [int] $Width = 1200,
    [int] $Height = 820
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$deadline = (Get-Date).AddSeconds(60)
$window = $null
while (-not $window -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process | Where-Object { $_.MainWindowTitle -like $TitleLike } | Select-Object -First 1
}
if (-not $window) { throw "No window titled like $TitleLike" }

$handle = $window.MainWindowHandle
[Win]::ShowWindow($handle, 9) | Out-Null   # restore if maximized
[Win]::MoveWindow($handle, 40, 40, $Width, $Height, $true) | Out-Null
Start-Sleep -Seconds $DelaySeconds

$rect = New-Object Win+RECT
[Win]::GetWindowRect($handle, [ref] $rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[Win]::PrintWindow($handle, $hdc, 2) | Out-Null   # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "Saved $Out ($w x $h)"
