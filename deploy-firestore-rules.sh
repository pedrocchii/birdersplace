#!/bin/bash

# Script para desplegar las reglas de Firestore
echo "🚀 Desplegando reglas de Firestore..."

# Verificar que Firebase CLI esté instalado
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI no está instalado. Instálalo con:"
    echo "npm install -g firebase-tools"
    exit 1
fi

# Verificar que estemos en un proyecto Firebase
if [ ! -f "firebase.json" ]; then
    echo "❌ No se encontró firebase.json. Asegúrate de estar en el directorio del proyecto."
    exit 1
fi

# Desplegar solo las reglas de Firestore
echo "📝 Desplegando reglas de Firestore..."
firebase deploy --only firestore:rules

if [ $? -eq 0 ]; then
    echo "✅ Reglas de Firestore desplegadas exitosamente"
    echo "🎯 Los errores de permisos deberían resolverse ahora"
else
    echo "❌ Error al desplegar las reglas de Firestore"
    echo "💡 Asegúrate de estar autenticado con Firebase CLI:"
    echo "firebase login"
fi
