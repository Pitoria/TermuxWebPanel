<img width="1353" height="609" alt="image" src="https://github.com/user-attachments/assets/f93e408f-ac20-450a-9e66-85e93691bf3d" />
<img width="1366" height="609" alt="image" src="https://github.com/user-attachments/assets/74b810a3-b854-464a-8986-b239414e3818" />
# Remote Agent Panel (Universal Orchestrator)

¡Bienvenido a **Remote Agent Panel**! 
Un orquestador web moderno y liviano diseñado para administrar dispositivos de forma remota. Fue concebido originalmente para celulares con Termux, pero su arquitectura lo hace **100% compatible con cualquier dispositivo que pueda ejecutar Python y Node.js**.

Ideal para montar granjas de servidores, orquestar bots, administrar servidores de juegos (como Minecraft) o dar nueva vida a hardware viejo (PCs antiguas, Raspberry Pis, TV Boxes, celulares Android).

## ✨ Características Principales

- **Multiplataforma:** El agente funciona de forma nativa en Linux, Windows, macOS y entornos Android (Termux). Detecta el sistema operativo y adapta la terminal automáticamente (`cmd.exe`, `/bin/bash`, etc.).
- **Consola Interactiva Remota (PTY):** Terminal 100% funcional desde el navegador.
- **Botones Rápidos (Quick Actions):** Creá macros y botones personalizados (ej. Iniciar/Detener servidor, ejecutar scripts) inyectables directamente en la terminal con un clic.
- **Explorador de Archivos:** Navegá, editá, subí y eliminá archivos de tus dispositivos cómodamente desde la web.
- **Métricas en Tiempo Real:** Monitoreo en vivo del uso de CPU, Memoria RAM y almacenamiento de cada agente.
- **Multiusuario y Permisos:** Sistema de roles (Admin/Viewer) para que puedas dar acceso restringido a tu equipo de trabajo sin comprometer el control total de los servidores.
- **Liviano y Eficiente:** El agente cliente está escrito en Python puro (sin dependencias pesadas extrañas).

---

## 🚀 Guía de Instalación

El sistema se compone de dos partes: El **Panel Web** (Node.js) y el **Agente** (Python).

### 1. El Panel Web (Servidor Central)
Necesitás tener instalado [Node.js](https://nodejs.org/) en la máquina que va a actuar de cerebro (puede ser tu PC local o un VPS en la nube).

```bash
# 1. Entrar a la carpeta del servidor
cd server/

# 2. Instalar dependencias
npm install

# 3. Iniciar el panel
node server.js
```
El panel estará disponible en `http://localhost:3000`. 
**Credenciales por defecto:**
- Usuario: `admin`
- Contraseña: `admin`

*(¡Recordá cambiar la contraseña apenas inicies sesión desde la pestaña de Configuración de Usuarios!)*

### 2. El Agente (Tus equipos a controlar)
En cada máquina (PC con Windows, servidor Linux, o celular Android) que quieras controlar, necesitás correr el agente. Solo requiere tener Python instalado.

```bash
# 1. Copiá el archivo agent.py al dispositivo y ejecutalo por primera vez
python agent.py

# 2. Se generará automáticamente un archivo config.json
# Editalo para poner la IP y Puerto de tu Panel Web, y elegí un nombre (Agent ID).
nano config.json # (o bloc de notas en Windows)

# 3. Volvé a correr el agente
python agent.py
```
¡Listo! Verás que el dispositivo aparece automáticamente en tu Panel Web, listo para ser orquestado.

---

## 🔒 Licencia y Seguridad
Este proyecto se distribuye bajo la licencia **MIT**, por lo que es libre de uso comercial, personal y modificaciones (ver archivo `LICENSE`).

**Aviso de Seguridad:** Nunca expongas directamente los puertos de la base de datos o de los agentes al público sin un Proxy Inverso (como Nginx o Cloudflare) y certificados SSL si planeás usarlo fuera de tu red local o VPN.

---

**¡Hecho con ❤️ para la comunidad!**
