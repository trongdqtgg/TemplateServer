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
rem Thu tu lay token: bien moi truong GH_TOKEN -> file gh-token.txt -> hoi nhap tai day.
set "SAVETOKEN="
if "%GH_TOKEN%"=="" if exist gh-token.txt set /p GH_TOKEN=<gh-token.txt
if "%GH_TOKEN%"=="" call :asktoken
if "%GH_TOKEN%"=="" goto notoken

:checktoken
echo.
echo Dang kiem tra token voi GitHub...
node scripts\check-token.js
if not errorlevel 1 goto tokenok
echo.
choice /c YN /m "Nhap token khac"
if errorlevel 2 goto stop
set "GH_TOKEN="
call :asktoken
if "%GH_TOKEN%"=="" goto notoken
goto checktoken

:tokenok
if not defined SAVETOKEN goto tokendone
choice /c YN /m "Luu token vao gh-token.txt de lan sau khong phai nhap lai"
if errorlevel 2 goto tokendone
>gh-token.txt echo %GH_TOKEN%
echo Da luu vao gh-token.txt. KHONG gui file nay cho ai, KHONG dua len GitHub.
:tokendone
echo.

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
exit /b 0

rem ---------- Cac doan xu ly phu ----------
:asktoken
echo.
echo Dan GitHub token vao day roi bam Enter.
echo ^(Chuot phai hoac Ctrl+V de dan. Ky tu bi an khi go - day la binh thuong.^)
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "$s = Read-Host 'Token' -AsSecureString; ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))).Trim()"`) do set "GH_TOKEN=%%t"
if not "%GH_TOKEN%"=="" set "SAVETOKEN=1"
goto :eof

:notoken
echo.
echo LOI: Chua nhap GitHub token.
echo Tao token tai: GitHub ^> Settings ^> Developer settings ^> Personal access tokens ^> Fine-grained tokens
echo Chon dung kho phat hanh, cap quyen "Contents: Read and write".
echo.
pause
exit /b 1

:stop
echo.
echo Da dung, chua phat hanh gi.
pause
exit /b 1
