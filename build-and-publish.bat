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
rem Lay token tu file gh-token.txt, chua co thi hoi nhap tai day.
rem Bo qua bien GH_TOKEN co san tren may (co the la token cu).
set "GH_TOKEN="
set "SAVETOKEN="
if exist gh-token.txt call :readtokenfile
if "%GH_TOKEN%"=="" call :asktoken
if "%GH_TOKEN%"=="" goto notoken
call :showtoken

call :savetoken
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

:publish
echo.
echo [2/2] Dang build va phat hanh len GitHub Releases...
call npm run dist:win:publish
if not errorlevel 1 goto published
echo.
echo LOI: build hoac phat hanh that bai. Xem chi tiet loi ben tren.
echo  - "401 Bad credentials": token sai, het han hoac da bi thu hoi.
echo  - "403" / "404": token chua duoc cap quyen "Contents: Read and write" cho dung kho,
echo    hoac ten kho trong package.json chua dung.
echo.
choice /c YN /m "Nhap token moi va phat hanh lai"
if errorlevel 2 goto failed
if exist gh-token.txt del gh-token.txt
set "GH_TOKEN="
call :asktoken
if "%GH_TOKEN%"=="" goto notoken
call :showtoken
call :savetoken
goto publish

:failed
echo.
pause
exit /b 1

:published

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
:readtokenfile
rem Doc bang PowerShell de bo ky tu an (BOM khi luu bang Notepad), dau cach, xuong dong, dau ngoac kep
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "$c = Get-Content -Raw -LiteralPath 'gh-token.txt'; if ($c) { $c.Trim().Trim([char]0xFEFF, [char]34, [char]39).Trim() }"`) do set "GH_TOKEN=%%t"
goto :eof

:showtoken
rem Chi hien 4 ky tu cuoi de doi chieu voi token tren GitHub, khong lo ca token
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "$t = $env:GH_TOKEN; if ($t.Length -gt 4) { $t.Substring($t.Length - 4) } else { '?' }"`) do set "TOKTAIL=%%t"
echo Dung token ket thuc bang ...%TOKTAIL%
goto :eof

:savetoken
if not defined SAVETOKEN goto :eof
set "SAVETOKEN="
choice /c YN /m "Luu token vao gh-token.txt de lan sau khong phai nhap lai"
if errorlevel 2 goto :eof
rem Ghi dang ASCII, khong BOM
powershell -NoProfile -Command "[IO.File]::WriteAllText('gh-token.txt', $env:GH_TOKEN, [Text.Encoding]::ASCII)"
echo Da luu vao gh-token.txt. KHONG gui file nay cho ai, KHONG dua len GitHub.
goto :eof

:asktoken
echo.
echo Dan GitHub token vao day roi bam Enter.
echo ^(Chuot phai hoac Ctrl+V de dan. Ky tu bi an khi go - day la binh thuong.^)
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "$s = Read-Host 'Token' -AsSecureString; ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))).Trim().Trim([char]34, [char]39).Trim()"`) do set "GH_TOKEN=%%t"
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
