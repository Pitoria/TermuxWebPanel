import os
import sys
import json
import time
import socket
import struct
import base64
import shutil
import threading
import select
import subprocess
import http.client
from urllib.parse import urlparse

# Detect platform
IS_WINDOWS = sys.platform.startswith('win')

if not IS_WINDOWS:
    try:
        import pty
        import fcntl
        import termios
        HAS_PTY = True
    except ImportError:
        HAS_PTY = False
else:
    HAS_PTY = False

class TermuxAgent:
    def __init__(self, config_path='config.json'):
        self.config_path = config_path
        self.host = 'localhost'
        self.port = 3001
        self.agent_id = ''
        self.token = ''
        
        self.sock = None
        self.running = False
        self.authenticated = False
        
        # Terminal process variables
        self.term_proc = None
        self.term_fd = None
        
        # CPU tracking for /proc/stat fallback
        self.last_cpu_idle = 0
        self.last_cpu_total = 0
        
        self.version = "1.1.0"
        
        self.load_config()

    def load_config(self):
        if not os.path.exists(self.config_path):
            print(f"Error: No se encontró el archivo de configuración {self.config_path}")
            template = {
                "server_host": "192.168.1.100",
                "server_port": 3001,
                "agent_id": "mi-celular-1",
                "auth_token": "token-aqui"
            }
            with open(self.config_path, 'w') as f:
                json.dump(template, f, indent=4)
            print(f"Se ha creado una plantilla en {self.config_path}. Por favor, configúrala.")
            sys.exit(1)

        try:
            with open(self.config_path, 'r') as f:
                config = json.load(f)
            self.host = config.get('server_host', 'localhost')
            self.port = int(config.get('server_port', 3001))
            self.agent_id = config.get('agent_id', '')
            self.token = config.get('auth_token', '')
        except Exception as e:
            print("Error al leer config.json:", e)
            sys.exit(1)

    def start(self):
        self.running = True
        print(f"Iniciando Agente Termux (ID: {self.agent_id}). Conectando a {self.host}:{self.port}...")
        
        while self.running:
            try:
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                self.sock.connect((self.host, self.port))
                
                if self.handshake():
                    self.authenticated = True
                    print("Autenticado con éxito ante el Servidor del Panel.")
                    
                    self.init_shell()
                    
                    stats_thread = threading.Thread(target=self.stats_loop, daemon=True)
                    stats_thread.start()
                    
                    self.recv_loop()
                else:
                    print("Error de autenticación. Reintentando...")
            except Exception as e:
                print("Error de conexión:", e)
            
            self.cleanup()
            print("Conexión perdida. Reintentando en 5 segundos...")
            time.sleep(5)

    def handshake(self):
        try:
            payload = json.dumps({"id": self.agent_id, "token": self.token})
            self.send_packet(1, payload)
            
            msg_type, data = self.recv_packet()
            if msg_type == 1:
                res = json.loads(data.decode('utf-8'))
                return res.get('success', False)
        except Exception as e:
            print("Error durante handshake:", e)
        return False

    # Protocol Helpers
    def send_packet(self, msg_type, payload):
        if isinstance(payload, str):
            payload = payload.encode('utf-8')
        header = struct.pack('>IB', len(payload), msg_type)
        self.sock.sendall(header + payload)

    def recv_exact(self, n):
        data = b''
        while len(data) < n:
            packet = self.sock.recv(n - len(data))
            if not packet:
                return None
            data += packet
        return data

    def recv_packet(self):
        header = self.recv_exact(5)
        if not header:
            return None, None
        length, msg_type = struct.unpack('>IB', header)
        payload = self.recv_exact(length)
        if payload is None:
            return None, None
        return msg_type, payload

    # SHELL SPAWNING
    def init_shell(self):
        self.close_shell()
        
        shell = '/bin/sh'
        if IS_WINDOWS:
            shell = 'cmd.exe'
        else:
            termux_login = '/data/data/com.termux/files/usr/bin/login'
            termux_bash = '/data/data/com.termux/files/usr/bin/bash'
            if os.path.exists(termux_login):
                shell = termux_login
            elif os.path.exists(termux_bash):
                shell = termux_bash
            elif os.path.exists('/bin/bash'):
                shell = '/bin/bash'

        if HAS_PTY:
            pid, fd = pty.fork()
            if pid == 0:
                os.environ['TERM'] = 'xterm-256color'
                os.environ['HOME'] = os.path.expanduser('~')
                try:
                    os.execv(shell, [shell])
                except Exception as e:
                    sys.exit(1)
            else:
                self.term_fd = fd
                threading.Thread(target=self.shell_read_loop, daemon=True).start()
        else:
            print(f"PTY no soportado. Iniciando shell en modo tubería: {shell}")
            env = os.environ.copy()
            if IS_WINDOWS:
                env['COLUMNS'] = '120'
                env['LINES'] = '30'
            self.term_proc = subprocess.Popen(
                [shell],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                shell=False
            )
            threading.Thread(target=self.shell_read_loop_fallback, daemon=True).start()

    def shell_read_loop(self):
        while self.authenticated and self.term_fd is not None:
            try:
                r, w, x = select.select([self.term_fd], [], [], 1.0)
                if self.term_fd in r:
                    data = os.read(self.term_fd, 4096)
                    if not data:
                        break
                    self.send_packet(2, data)
            except Exception as e:
                break
        print("Lectura de PTY terminada.")

    def shell_read_loop_fallback(self):
        proc = self.term_proc
        while self.authenticated and proc and proc.poll() is None:
            try:
                data = proc.stdout.read(1)
                if not data:
                    break
                self.send_packet(2, data)
            except Exception as e:
                break
        print("Lectura de Shell fallback terminada.")

    def close_shell(self):
        if self.term_fd is not None:
            try:
                os.close(self.term_fd)
            except:
                pass
            self.term_fd = None
        if self.term_proc:
            try:
                self.term_proc.kill()
            except:
                pass
            self.term_proc = None

    # RECEIVE NETWORK CONTROL LOOP
    def recv_loop(self):
        while self.authenticated:
            try:
                msg_type, payload = self.recv_packet()
                if msg_type is None:
                    break
                
                if msg_type == 1:
                    self.handle_json_msg(payload.decode('utf-8'))
                elif msg_type == 2:
                    if HAS_PTY and self.term_fd is not None:
                        os.write(self.term_fd, payload)
                    elif self.term_proc and self.term_proc.stdin:
                        data = payload
                        if IS_WINDOWS:
                            data = data.replace(b'\r', b'\r\n')
                        self.term_proc.stdin.write(data)
                        self.term_proc.stdin.flush()
            except Exception as e:
                print("Error en bucle de recepción:", e)
                break

    def handle_json_msg(self, json_str):
        try:
            msg = json.loads(json_str)
            m_type = msg.get('type')
            
            if m_type == 'term_resize':
                cols = msg.get('cols', 80)
                rows = msg.get('rows', 24)
                self.resize_terminal(cols, rows)
                
            elif m_type == 'file_op':
                op = msg.get('op')
                path = msg.get('path')
                req_id = msg.get('reqId')
                self.handle_file_op(op, path, req_id, msg)
                
            elif m_type == 'start_upload_to_server':
                path = msg.get('path')
                transfer_id = msg.get('transferId')
                url = msg.get('url')
                threading.Thread(target=self.http_upload_stream, args=(path, transfer_id, url), daemon=True).start()
                
            elif m_type == 'start_download_from_server':
                path = msg.get('path')
                transfer_id = msg.get('transferId')
                url = msg.get('url')
                threading.Thread(target=self.http_download_stream, args=(path, transfer_id, url), daemon=True).start()
                
            elif m_type == 'update_agent':
                url = msg.get('url')
                threading.Thread(target=self.self_update, args=(url,), daemon=True).start()
                
        except Exception as e:
            print("Error al procesar JSON de control:", e)

    def get_http_connection(self, url):
        parsed = urlparse(url)
        if parsed.scheme == 'https':
            return http.client.HTTPSConnection(parsed.netloc), parsed
        else:
            return http.client.HTTPConnection(parsed.netloc), parsed

    def http_upload_stream(self, file_path, transfer_id, url):
        print(f"Iniciando subida por streaming HTTP: {file_path} -> {url}")
        base_dir = os.path.expanduser('~')
        if not os.path.isabs(file_path) and not file_path.startswith('.'):
            full_path = os.path.abspath(os.path.join(base_dir, file_path))
        else:
            full_path = os.path.abspath(file_path)
            
        try:
            if not os.path.exists(full_path):
                raise Exception("El archivo no existe")
                
            file_size = os.path.getsize(full_path)
            conn, parsed = self.get_http_connection(url)
            
            # Start request headers
            path_with_query = parsed.path + ("?" + parsed.query if parsed.query else "")
            conn.putrequest("POST", path_with_query)
            conn.putheader("Content-Length", str(file_size))
            conn.putheader("Content-Type", "application/octet-stream")
            conn.endheaders()
            
            # Stream the file content
            with open(full_path, "rb") as f:
                while True:
                    chunk = f.read(256 * 1024) # 256KB chunks
                    if not chunk:
                        break
                    conn.send(chunk)
                    
            response = conn.getresponse()
            res_data = response.read()
            conn.close()
            print(f"Subida de streaming HTTP completada. Status: {response.status}")
        except Exception as e:
            print(f"Error en http_upload_stream: {e}")

    def http_download_stream(self, file_path, transfer_id, url):
        print(f"Iniciando descarga por streaming HTTP: {url} -> {file_path}")
        base_dir = os.path.expanduser('~')
        if not os.path.isabs(file_path) and not file_path.startswith('.'):
            full_path = os.path.abspath(os.path.join(base_dir, file_path))
        else:
            full_path = os.path.abspath(file_path)
            
        try:
            # Create directories if needed
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            conn, parsed = self.get_http_connection(url)
            path_with_query = parsed.path + ("?" + parsed.query if parsed.query else "")
            conn.request("GET", path_with_query)
            response = conn.getresponse()
            
            if response.status == 200:
                with open(full_path, "wb") as f:
                    while True:
                        chunk = response.read(256 * 1024) # 256KB chunks
                        if not chunk:
                            break
                        f.write(chunk)
                print(f"Descarga de streaming HTTP completada. Archivo guardado en {full_path}")
            else:
                raise Exception(f"El servidor respondió con código {response.status}")
            
            conn.close()
        except Exception as e:
            print(f"Error en http_download_stream: {e}")

    def self_update(self, url):
        print(f"Recibida orden de auto-actualización desde: {url}")
        try:
            conn, parsed = self.get_http_connection(url)
            path_with_query = parsed.path + ("?" + parsed.query if parsed.query else "")
            conn.request("GET", path_with_query)
            response = conn.getresponse()
            
            if response.status == 200:
                new_code = response.read()
                conn.close()
                
                if len(new_code) > 5000 and b"class TermuxAgent" in new_code:
                    # Get current script path
                    script_path = os.path.abspath(sys.argv[0])
                    # Write to temp file first
                    temp_path = script_path + ".tmp"
                    with open(temp_path, "wb") as f:
                        f.write(new_code)
                        
                    # Replace original script
                    if os.path.exists(script_path):
                        os.remove(script_path)
                    os.rename(temp_path, script_path)
                    
                    print("Auto-actualización descargada con éxito. Reiniciando proceso...")
                    self.cleanup()
                    
                    # Restart the python script
                    os.execv(sys.executable, [sys.executable] + sys.argv)
                else:
                    raise Exception("El código descargado es inválido o corrupto")
            else:
                raise Exception(f"Error HTTP {response.status}")
        except Exception as e:
            print(f"Error durante la auto-actualización: {e}")

    def resize_terminal(self, cols, rows):
        if HAS_PTY and self.term_fd is not None:
            try:
                size = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.term_fd, termios.TIOCSWINSZ, size)
            except Exception as e:
                print("Error al cambiar tamaño de PTY:", e)

    # FILE OPERATIONS CONTROLLER
    def handle_file_op(self, op, path, req_id, msg):
        base_dir = os.path.expanduser('~')
        if not os.path.isabs(path) and not path.startswith('.'):
            full_path = os.path.abspath(os.path.join(base_dir, path))
        else:
            full_path = os.path.abspath(path)
        
        response = {"type": "file_op_res", "reqId": req_id, "success": True}
        
        try:
            if op == 'list':
                if not os.path.exists(full_path):
                    os.makedirs(full_path, exist_ok=True)
                
                files = []
                for name in os.listdir(full_path):
                    f_path = os.path.join(full_path, name)
                    try:
                        stat = os.stat(f_path)
                        files.append({
                            "name": name,
                            "is_dir": os.path.isdir(f_path),
                            "size": stat.st_size,
                            "mtime": stat.st_mtime
                        })
                    except:
                        pass
                response["files"] = files

            elif op == 'read_text':
                with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                    response["content"] = f.read()

            elif op == 'write_text':
                content = msg.get('content', '')
                with open(full_path, 'w', encoding='utf-8') as f:
                    f.write(content)

            elif op == 'read':
                with open(full_path, 'rb') as f:
                    data = f.read()
                response["content"] = base64.b64encode(data).decode('utf-8')

            elif op == 'write':
                b64_content = msg.get('content', '')
                with open(full_path, 'wb') as f:
                    f.write(base64.b64decode(b64_content))

            elif op == 'upload_chunk':
                chunk_b64 = msg.get('chunk', '')
                offset = msg.get('offset', 0)
                
                mode = 'wb' if offset == 0 else 'ab'
                with open(full_path, mode) as f:
                    f.write(base64.b64decode(chunk_b64))

            elif op == 'mkdir':
                os.makedirs(full_path, exist_ok=True)

            elif op == 'delete':
                if os.path.isdir(full_path):
                    shutil.rmtree(full_path)
                else:
                    os.remove(full_path)
            else:
                response["success"] = False
                response["error"] = f"Operación '{op}' no soportada"

        except Exception as e:
            response["success"] = False
            response["error"] = str(e)

        self.send_packet(1, json.dumps(response))

    # STATS GATHERING LOOP
    def stats_loop(self):
        while self.authenticated:
            try:
                stats = {
                    "cpu": self.get_cpu_usage(),
                    "ram_used": self.get_ram_used(),
                    "ram_total": self.get_ram_total(),
                    "disk_used": self.get_disk_used(),
                    "disk_total": self.get_disk_total(),
                    "battery": self.get_battery(),
                    "uptime": self.get_uptime(),
                    "ip": self.get_local_ip(),
                    "version": self.version
                }
                
                self.send_packet(1, json.dumps({
                    "type": "stats",
                    "stats": stats
                }))
            except Exception as e:
                print("Error reuniendo métricas:", e)
            
            time.sleep(3)

    # METRICS SCRAPERS
    def get_cpu_usage(self):
        if IS_WINDOWS:
            return self._get_cpu_windows()
            
        # Android check
        is_android = os.path.exists('/data/data/com.termux') or 'ANDROID_ROOT' in os.environ
        
        if is_android:
            # Android/Termux: aggregate %cpu line is broken (cgroup restriction).
            # Sum per-process [%CPU] from top instead — those ARE accurate.
            try:
                out = subprocess.check_output(
                    ['top', '-d', '1', '-b', '-n', '2', '-m', '20'],
                    timeout=10, stderr=subprocess.DEVNULL
                ).decode('utf-8', errors='replace')
                cpu_total = 0.0
                seen_pids = set()
                batches = out.split('Tasks:')
                proc_batch = batches[-1] if len(batches) >= 2 else out
                for line in proc_batch.splitlines():
                    parts = line.split()
                    if len(parts) >= 9:
                        try:
                            pid = int(parts[0])
                            for i, p in enumerate(parts):
                                if p in ('S', 'R', 'S+', 'Rs', 'R+', 'Sl', 'SN', 'Ss', 'I', 'Z'):
                                    cpu_str = parts[i + 1]
                                    if cpu_str.replace('.', '').isdigit():
                                        if pid not in seen_pids:
                                            seen_pids.add(pid)
                                            cpu_total += float(cpu_str)
                                    break
                        except (ValueError, IndexError):
                            pass
                return round(min(cpu_total, 100.0), 1) if cpu_total > 0 else 0.0
            except Exception as e:
                pass
                
        # Desktop Linux / Fallback: read /proc/stat
        try:
            with open('/proc/stat', 'r') as f:
                line = f.readline()
            parts = line.split()
            if len(parts) >= 5:
                user = float(parts[1])
                nice = float(parts[2])
                system = float(parts[3])
                idle = float(parts[4])
                iowait = float(parts[5]) if len(parts) > 5 else 0.0
                irq = float(parts[6]) if len(parts) > 6 else 0.0
                softirq = float(parts[7]) if len(parts) > 7 else 0.0
                
                total = user + nice + system + idle + iowait + irq + softirq
                
                last_idle = getattr(self, 'last_cpu_idle', 0.0)
                last_total = getattr(self, 'last_cpu_total', 0.0)
                
                self.last_cpu_idle = idle
                self.last_cpu_total = total
                
                if last_total > 0:
                    diff_idle = idle - last_idle
                    diff_total = total - last_total
                    if diff_total > 0:
                        usage = 100.0 * (1.0 - diff_idle / diff_total)
                        return round(max(0.0, min(100.0, usage)), 1)
        except Exception as e:
            pass
            
        return 0.0

    def _get_cpu_windows(self):
        # Try powershell Get-CimInstance (Win 8+)
        try:
            out = subprocess.check_output(
                ['powershell', '-Command',
                 '(Get-CimInstance Win32_Processor).LoadPercentage'],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode('utf-8', errors='replace').strip()
            if out.isdigit():
                return round(float(out), 1)
        except:
            pass

        # Try powershell Get-WmiObject (Win 7)
        try:
            out = subprocess.check_output(
                ['powershell', '-Command',
                 '(Get-WmiObject Win32_Processor).LoadPercentage'],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode('utf-8', errors='replace').strip()
            if out.isdigit():
                return round(float(out), 1)
        except:
            pass

        # Try wmic (Win XP / fallback)
        try:
            out = subprocess.check_output(
                ['wmic', 'cpu', 'get', 'loadpercentage'],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode('utf-8', errors='replace')
            for line in out.splitlines():
                line = line.strip()
                if line.isdigit():
                    return round(float(line), 1)
        except:
            pass

        return 0.0

    def get_ram_used(self):
        if IS_WINDOWS:
            return self._get_ram_windows()[0]
        try:
            meminfo = {}
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        meminfo[parts[0].rstrip(':')] = int(parts[1]) * 1024
            total = meminfo.get('MemTotal', 0)
            available = meminfo.get('MemAvailable', 0)
            if not available:
                available = meminfo.get('MemFree', 0) + meminfo.get('Buffers', 0) + meminfo.get('Cached', 0)
            return total - available
        except:
            return 0

    def get_ram_total(self):
        if IS_WINDOWS:
            return self._get_ram_windows()[1]
        try:
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if line.startswith('MemTotal:'):
                        return int(line.split()[1]) * 1024
        except:
            pass
        return 0

    def _get_ram_windows(self):
        # Try CIM (Win 8+)
        try:
            out = subprocess.check_output(
                ['powershell', '-Command',
                 '$m=Get-CimInstance Win32_OperatingSystem; '
                 '$t=$m.TotalVisibleMemorySize; '
                 '$f=$m.FreePhysicalMemory; '
                 'Write-Output $t $f'],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode('utf-8', errors='replace').strip()
            parts = out.split()
            if len(parts) >= 2:
                total = int(parts[0]) * 1024
                free = int(parts[1]) * 1024
                return (total - free, total)
        except:
            pass

        # Try WMI (Win 7)
        try:
            out = subprocess.check_output(
                ['powershell', '-Command',
                 '$m=Get-WmiObject Win32_OperatingSystem; '
                 '$t=$m.TotalVisibleMemorySize; '
                 '$f=$m.FreePhysicalMemory; '
                 'Write-Output $t $f'],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode('utf-8', errors='replace').strip()
            parts = out.split()
            if len(parts) >= 2:
                total = int(parts[0]) * 1024
                free = int(parts[1]) * 1024
                return (total - free, total)
        except:
            pass

        # Try wmic (Win XP / fallback)
        try:
            out = subprocess.check_output(
                ['wmic', 'os', 'get', 'FreePhysicalMemory,TotalVisibleMemorySize', '/format:list'],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode('utf-8', errors='replace')
            free_kb, total_kb = 0, 0
            for line in out.splitlines():
                if 'FreePhysicalMemory' in line:
                    free_kb = int(line.split('=')[1].strip())
                elif 'TotalVisibleMemorySize' in line:
                    total_kb = int(line.split('=')[1].strip())
            if total_kb > 0:
                total = total_kb * 1024
                free = free_kb * 1024
                return (total - free, total)
        except:
            pass

        return (1024*1024*1024, 4096*1024*1024)

    def get_disk_used(self):
        try:
            total, used, free = shutil.disk_usage('.')
            return used
        except:
            return 0

    def get_disk_total(self):
        try:
            total, used, free = shutil.disk_usage('.')
            return total
        except:
            return 0

    def get_battery(self):
        try:
            capacity_path = '/sys/class/power_supply/battery/capacity'
            if os.path.exists(capacity_path):
                with open(capacity_path, 'r') as f:
                    return int(f.read().strip())
        except:
            pass
        
        try:
            out = subprocess.check_output(['termux-battery-status'], timeout=1)
            data = json.loads(out)
            return int(data.get('percentage'))
        except:
            return None

    def get_uptime(self):
        if IS_WINDOWS:
            return time.process_time()
        try:
            with open('/proc/uptime', 'r') as f:
                return float(f.readline().split()[0])
        except:
            return 0.0

    def get_local_ip(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((self.host, self.port))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except:
            pass
            
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except:
            return '127.0.0.1'

    # CLEANUP
    def cleanup(self):
        self.authenticated = False
        self.close_shell()
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None

if __name__ == '__main__':
    agent = TermuxAgent()
    try:
        agent.start()
    except KeyboardInterrupt:
        print("\nDeteniendo Agente...")
        agent.cleanup()
