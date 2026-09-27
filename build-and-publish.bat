@echo off
setlocal
cd /d "%~dp0"

echo ===============================================
echo   May chu mau dien form - Build va phat hanh ban moi
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo LOI: May nay chua cai Node.js.
  echo Tai va cai Node.js ^(ban LTS^) tai: https://nodejs.org/
  echo roi chay lai file nay.
  echo.
  pause
  exit /b 1
)

rem Kiem tra da khai bao kho GitHub trong package.json chua
findstr /c:"TEN_TAI_KHOAN_GITHUB" package.json >nul
if not errorlevel 1 (
  echo LOI: Chua khai bao kho GitHub.
  echo Mo file package.json, tim "TEN_TAI_KHOAN_GITHUB" va thay bang ten tai khoan GitHub cua ban,
  echo "form-mau-server" thay bang ten kho ^(repo^) chua cac ban phat hanh.
  echo.
  pause
  exit /b 1
)

rem Token GitHub: KHONG ghi truc tiep vao file nay.
rem Lay tu bien moi truong GH_TOKEN, hoac tu file gh-token.txt nam canh file nay
rem (file gh-token.txt chi co 1 dong la token, da duoc loai khoi git trong .gitignore).
if "%GH_TOKEN%"=="" if exist gh-token.txt set /p GH_TOKEN=<gh-token.txt
if "%GH_TOKEN%"=="" (
  echo LOI: Chua co GitHub token.
  echo Tao file gh-token.txt canh file nay, dan token vao dong dau tien roi luu lai.
  echo Token can quyen "Contents: Read and write" tren kho phat hanh.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set CURVER=%%v
echo Phien ban hien tai trong package.json: %CURVER%
echo.
echo Cac may chi nhan ban moi neu so phien ban LON HON lan phat hanh truoc.
choice /c YN /m "Tu dong tang phien ban len 1 bac (vd 1.0.0 -> 1.0.1)"
if errorlevel 2 goto keepver
call npm version patch --no-git-tag-version >nul
if errorlevel 1 (
  echo LOI: khong tang duoc phien ban.
  pause
  exit /b 1
)
:keepver
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set NEWVER=%%v

echo.
echo Se phat hanh ban: %NEWVER%
echo Bam phim bat ky de tiep tuc, hoac dong cua so nay ^(bam X^) de huy.
pause >nul

echo.
echo [1/2] Dang cai dat thu vien can thiet...
call npm install
if errorlevel 1 (
  echo.
  echo LOI: cai dat thu vien that bai. Kiem tra ket noi mang roi chay lai.
  echo.
  pause
  exit /b 1
)

echo.
echo [2/2] Dang build va phat hanh len GitHub Releases...
call npm run dist:win:publish
if errorlevel 1 (
  echo.
  echo LOI: build hoac phat hanh that bai. Xem chi tiet loi ben tren.
  echo Loi thuong gap: token het han / sai quyen, hoac phien ban %NEWVER% da ton tai tren GitHub.
  echo.
  pause
  exit /b 1
)

echo.
echo ===============================================
echo   XONG! Ban %NEWVER% da duoc dang len GitHub Releases.
echo   Cac may dang chay ban cu se tu tai va cai ban nay trong
echo   lan kiem tra ke tiep ^(toi da 4 tieng^), hoac bam
echo   "Kiem tra cap nhat" o bieu tuong duoi khay he thong.
echo   File cai dat: dist\May-chu-mau-Setup-%NEWVER%.exe
echo ===============================================
echo.
pause
