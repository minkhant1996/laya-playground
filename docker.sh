#!/usr/bin/env bash
# Docker helper: ./docker.sh install | build | up | down | restart | logs | status | clean
set -euo pipefail
cd "$(dirname "$0")"
CMD="${1:-help}"

os() { case "$(uname -s)" in Darwin) echo mac;; Linux) echo linux;; MINGW*|MSYS*|CYGWIN*) echo windows;; *) echo other;; esac; }

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then echo "Docker is already installed: $(docker --version)"; return; fi
  case "$(os)" in
    linux)
      echo "==> Installing Docker Engine via get.docker.com (needs sudo)"
      curl -fsSL https://get.docker.com | sudo sh      # installs Engine + compose plugin
      sudo usermod -aG docker "$USER" || true
      echo "Log out and back in (or run: newgrp docker) so you can use docker without sudo." ;;
    mac)
      if command -v brew >/dev/null 2>&1; then echo "==> brew install --cask docker"; brew install --cask docker
      else echo "Download Docker Desktop: https://docs.docker.com/desktop/setup/install/mac-install/"; open "https://docs.docker.com/desktop/setup/install/mac-install/" || true; fi
      echo "Open the Docker app once so the engine starts, then re-run: ./docker.sh up" ;;
    windows)
      echo "Use docker.bat on Windows (installs Docker Desktop with winget)." ;;
    *) echo "Unknown OS. See https://docs.docker.com/get-docker/" ;;
  esac
}

need_docker() {
  command -v docker >/dev/null 2>&1 || { echo "Docker not found. Run: ./docker.sh install"; exit 1; }
  docker info >/dev/null 2>&1 || { echo "Docker daemon is not running or you lack permission. Start Docker Desktop / 'sudo systemctl start docker', or add yourself to the docker group."; exit 1; }
  if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose"
  else echo "Docker Compose not found. Linux: sudo apt install docker-compose-plugin (or ./docker.sh install). Desktop includes it."; exit 1; fi
}

case "$CMD" in
  install) install_docker ;;
  build)   need_docker; $COMPOSE build ;;
  up)      need_docker; $COMPOSE up -d --build; echo; echo "Frontend: http://localhost:5173   Backend API: http://127.0.0.1:8765/docs"; echo "Logs: ./docker.sh logs   Stop: ./docker.sh down" ;;
  down|stop) need_docker; $COMPOSE down ;;
  restart) need_docker; $COMPOSE restart ;;
  logs)    need_docker; $COMPOSE logs -f --tail=200 ;;
  status|ps) need_docker; $COMPOSE ps ;;
  clean)   need_docker; $COMPOSE down -v --rmi local; echo "Containers, images and volumes removed." ;;
  *) echo "Usage: ./docker.sh {install|build|up|down|restart|logs|status|clean}" ;;
esac
