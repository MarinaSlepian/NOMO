$basePath = "D:\Angular study\NOMO\NOMO-apps-project\src\assets\videos"
Get-ChildItem -Recurse -File -Path $basePath | ForEach-Object {
  $relativePath = $_.FullName.Substring($basePath.Length + 1) -replace "\\","/"
  wrangler r2 object put "nomo-videos/$relativePath" --file $_.FullName
}