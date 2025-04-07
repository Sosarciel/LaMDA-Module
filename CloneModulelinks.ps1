# 确保当前目录是 git 仓库的根目录
if (!(Test-Path ".modulelinks")) {
    Write-Host "未找到 .modulelinks 文件，请确保在正确的仓库根目录" -ForegroundColor Red
    Exit 1
}

# 读取 .modulelinks 文件
Write-Host "正在读取 .modulelinks 文件..." -ForegroundColor Yellow
$gitmodules = Get-Content ".modulelinks"

# 初始化变量
$submodules = @()

# 提取路径和 URL
foreach ($line in $gitmodules) {
    if ($line -match "path = (.+)") {
        $path = $Matches[1]
    } elseif ($line -match "url = (.+)") {
        $url = $Matches[1]
        # 将子模块信息加入列表
        $submodules += @{ Path = $path; Url = $url }
    }
}

# 遍历并克隆子模块
foreach ($submodule in $submodules) {
    $path = $submodule.Path
    $url = $submodule.Url

    Write-Host "克隆子模块: $path <- $url" -ForegroundColor Green

    # 检查目录是否已存在
    if (Test-Path $path) {
        Write-Host "子模块目录已存在，跳过克隆: $path" -ForegroundColor Yellow
        continue
    }

    # 克隆子模块
    git clone --depth=1 $url $path
}
