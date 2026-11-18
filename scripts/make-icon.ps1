# Draws media/icon.png (256x256): an eye whose pupil is a Git branch node, on a rounded tile.
# Run from the repository root: powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# Tile
$tile = New-RoundedRect 8 8 240 240 52
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 256, 256), ([System.Drawing.Color]::FromArgb(255, 32, 52, 84)), ([System.Drawing.Color]::FromArgb(255, 14, 24, 40))
$g.FillPath($bg, $tile)

# Eye outline (two arcs meeting at the corners)
$white = [System.Drawing.Color]::FromArgb(255, 240, 246, 252)
$accent = [System.Drawing.Color]::FromArgb(255, 241, 80, 47)   # Git orange
$eye = New-Object System.Drawing.Drawing2D.GraphicsPath
$eye.AddBezier(36, 128, 76, 64, 180, 64, 220, 128)
$eye.AddBezier(220, 128, 180, 192, 76, 192, 36, 128)
$eye.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 36, 58))), $eye)
$pen = New-Object System.Drawing.Pen $white, 14
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($pen, $eye)

# Pupil: a Git branch glyph (two commits joined by a line, plus a branch)
$line = New-Object System.Drawing.Pen $accent, 9
$line.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$line.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($line, 112, 102, 112, 154)
$branch = New-Object System.Drawing.Drawing2D.GraphicsPath
$branch.AddBezier(146, 110, 146, 132, 112, 128, 112, 146)
$g.DrawPath($line, $branch)
$dot = New-Object System.Drawing.SolidBrush $accent
$g.FillEllipse($dot, 101, 91, 22, 22)
$g.FillEllipse($dot, 101, 145, 22, 22)
$g.FillEllipse($dot, 135, 99, 22, 22)

$out = Join-Path (Get-Location) 'media/icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "Wrote $out"
