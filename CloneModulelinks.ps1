# 确保当前目录是 git 仓库的根目录
if (!(Test-Path ".modulelinks")) {
    Write-Host "未找到 .modulelinks 文件，请确保在正确的仓库根目录" -ForegroundColor Red
    Exit 1
}

# --- 新增：确保 .git/info/exclude 存在 ---
$excludePath = ".git/info/exclude"
if (!(Test-Path ".git/info")) {
    New-Item -ItemType Directory -Force -Path ".git/info" | Out-Null
}
if (!(Test-Path $excludePath)) {
    New-Item -ItemType File -Force -Path $excludePath | Out-Null
}

# 读取 .modulelinks 文件
Write-Host "正在读取 .modulelinks 文件..." -ForegroundColor Yellow
$gitmodules = Get-Content ".modulelinks"

# 初始化变量
$submodules = @()

# 提取路径和 URL
foreach ($line in $gitmodules) {
    if ($line -match "path = (.+)") {
        $path = $Matches[1].Trim() # 加上 Trim() 防止有不可见空格
    } elseif ($line -match "url = (.+)") {
        $url = $Matches[1].Trim()
        # 将子模块信息加入列表
        $submodules += @{ Path = $path; Url = $url }
    }
}

# 遍历并克隆子模块，同时配置本地忽略
foreach ($submodule in $submodules) {
    $path = $submodule.Path
    $url = $submodule.Url

    Write-Host "`n[处理模块]: $path <- $url" -ForegroundColor Green

    # === 1. 克隆逻辑 ===
    if (Test-Path $path) {
        Write-Host "  -> 目录已存在，跳过克隆。" -ForegroundColor Yellow
    } else {
        Write-Host "  -> 正在克隆..." -ForegroundColor Cyan
        git clone --depth=1 $url $path
    }
}

Write-Host "`n所有模块初始化完毕！" -ForegroundColor Green