#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
TARGET="${INSTALL_DIR}/ovopre"

echo "[ovopre] project: ${ROOT_DIR}"
echo "[ovopre] checking node..."
node -v >/dev/null 2>&1 || { echo "[ovopre] node >=18 is required"; exit 1; }

mkdir -p "${INSTALL_DIR}"

cat > "${TARGET}" <<EOF
#!/usr/bin/env bash
exec node "${ROOT_DIR}/bin/ovopre.js" "\$@"
EOF
chmod +x "${TARGET}"

SHELL_RC=""
if [[ -n "${ZSH_VERSION:-}" ]]; then
  SHELL_RC="${HOME}/.zshrc"
elif [[ -n "${BASH_VERSION:-}" ]]; then
  SHELL_RC="${HOME}/.bashrc"
elif [[ -f "${HOME}/.bashrc" ]]; then
  SHELL_RC="${HOME}/.bashrc"
fi

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
if [[ -n "${SHELL_RC}" ]] && ! grep -Fq "${PATH_LINE}" "${SHELL_RC}" 2>/dev/null; then
  echo "${PATH_LINE}" >> "${SHELL_RC}"
  echo "[ovopre] added ~/.local/bin to PATH in ${SHELL_RC}"
fi

cat <<'EOF'
[ovopre] install complete.

Next:
  1) source ~/.bashrc  (or restart shell)
  2) export OPENAI_API_KEY=...
  3) optional: export OPENAI_BASE_URL=https://api.deepseek.com
  4) run: ovopre
EOF
