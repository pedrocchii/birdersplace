@echo off
REM Script para desplegar las reglas de Firestore en Windows

echo 🚀 Desplegando reglas de Firestore...

REM Verificar que Firebase CLI esté instalado
firebase --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Firebase CLI no está instalado. Instálalo con:
    echo npm install -g firebase-tools
    pause
    exit /b 1
)

REM Verificar que estemos en un proyecto Firebase
if not exist "firebase.json" (
    echo ❌ No se encontró firebase.json. Asegúrate de estar en el directorio del proyecto.
    pause
    exit /b 1
)

REM Desplegar solo las reglas de Firestore
echo 📝 Desplegando reglas de Firestore...
firebase deploy --only firestore:rules

if %errorlevel% equ 0 (
    echo ✅ Reglas de Firestore desplegadas exitosamente
    echo 🎯 Los errores de permisos deberían resolverse ahora
) else (
    echo ❌ Error al desplegar las reglas de Firestore
    echo 💡 Asegúrate de estar autenticado con Firebase CLI:
    echo firebase login
)

pause
