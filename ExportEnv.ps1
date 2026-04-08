# 定义输出文件的名称
$OutputFile = "Node-Env-Info.txt"

# 确保控制台输出和文件写入使用 UTF-8 编码，防止中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "🚀 开始收集环境信息，请稍候..." -ForegroundColor Cyan

# 1. 写入标题和时间
$CurrentTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"==================================================" | Out-File -FilePath $OutputFile -Encoding utf8
" Node.js 运行环境与全局包诊断报告" | Out-File -FilePath $OutputFile -Encoding utf8 -Append
" 导出时间: $CurrentTime" | Out-File -FilePath $OutputFile -Encoding utf8 -Append
"==================================================`n" | Out-File -FilePath $OutputFile -Encoding utf8 -Append

# 2. 收集系统与底层环境信息 (使用 npx envinfo)
Write-Host "-> 正在收集系统与 Node 基础信息..."
"--- [1. 系统与底层环境] ---" | Out-File -FilePath $OutputFile -Encoding utf8 -Append
# 运行 envinfo 并将输出追加到文件
npx envinfo --system --binaries | Out-File -FilePath $OutputFile -Encoding utf8 -Append

# 3. 收集 npm 全局包信息
Write-Host "-> 正在扫描 npm 全局安装包..."
"`n--- [2. npm 全局依赖包 (顶层)] ---" | Out-File -FilePath $OutputFile -Encoding utf8 -Append
# 运行 npm list 获取全局包，剔除多余的树状结构
npm list -g --depth=0 | Out-File -FilePath $OutputFile -Encoding utf8 -Append

Write-Host "✅ 导出成功！" -ForegroundColor Green
Write-Host "文件已保存至: $((Get-Item $OutputFile).FullName)" -ForegroundColor Yellow