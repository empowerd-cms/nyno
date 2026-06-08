from pathlib import Path

REQUIRED_ENV_KEYS = ("WF", "HOST", "SECRET")
RESERVED_SECRETS = {"change_me", "changeme", "test_secret_do_not_use"}


def _repo_root():
    return Path(__file__).resolve().parents[2]


def _parse_env_file(path):
    env = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "#" in line:
            line = line.split("#", 1)[0].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        env[key.strip()] = value
    return env


def load_benchmark_env():
    env_path = _repo_root() / ".env"
    if not env_path.exists():
        raise RuntimeError("Missing .env. Copy .env.template to .env and set a fresh SECRET before running benchmark tests.")

    env = _parse_env_file(env_path)
    for key in REQUIRED_ENV_KEYS:
        if not env.get(key):
            raise RuntimeError(f"Missing required env var: {key}")

    if env["SECRET"].strip().lower() in RESERVED_SECRETS:
        raise RuntimeError("SECRET must be a fresh value, not a placeholder, before running benchmark tests.")

    return env


BENCHMARK_ENV = load_benchmark_env()
HOST = BENCHMARK_ENV["HOST"]
PORT = int(BENCHMARK_ENV["WF"])
API_KEY = BENCHMARK_ENV["SECRET"]
