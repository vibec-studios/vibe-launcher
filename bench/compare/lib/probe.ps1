param([string]$Source)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -Path $Source -ReferencedAssemblies System.Drawing, UIAutomationClient, UIAutomationTypes, WindowsBase
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'exit') { break }
  [Console]::Out.WriteLine([BenchProbe]::Handle($line))
  [Console]::Out.Flush()
}
