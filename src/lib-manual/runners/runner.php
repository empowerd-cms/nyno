<?php
use Swoole\Server;
use Swoole\Coroutine;

/* ---------------- ENV LOADER ---------------- */

$basedir = realpath(__DIR__ . "/../../../");

function fail_nyno_env($message) {
    fwrite(STDERR, "ERROR: " . $message . PHP_EOL);
    exit(1);
}

function resolve_nyno_env_path($basedir) {
    $path = $basedir . "/.env";
    if (!file_exists($path)) {
        fail_nyno_env("Missing .env. Copy .env.template to .env and set a fresh SECRET.");
    }
    return $path;
}

function validate_nyno_runtime_env($env) {
    $required = ["WF", "GU", "PY", "JS", "DN", "PE", "RB", "HOST", "SECRET"];
    foreach ($required as $key) {
        if (!isset($env[$key]) || trim((string)$env[$key]) === '') {
            fail_nyno_env("Missing required env var: " . $key);
        }
    }

    $secret = strtolower(trim((string)$env["SECRET"]));
    if ($secret === "change_me" || $secret === "changeme") {
        fail_nyno_env("SECRET must be a fresh high-entropy value, not a placeholder.");
    }
}

function load_nyno_ports($path) {
    $env = [];
    if (!file_exists($path)) fail_nyno_env("Missing .env. Copy .env.template to .env and set a fresh SECRET.");
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) continue;
        if (strpos($line, '#') !== false) {
            $line = substr($line, 0, strpos($line, '#'));
        }
        if (strpos($line, '=') !== false) {
            [$k, $v] = array_map('trim', explode('=', $line, 2));
            $env[$k] = trim($v, "\"'");
        }
    }
    validate_nyno_runtime_env($env);
    return $env;
}

$ports = load_nyno_ports(resolve_nyno_env_path($basedir));

$host        = $ports['HOST']   ?? '127.0.0.1';
$pe_port    = $ports['PE']     ?? 9003;
$VALID_API_KEY = $ports['SECRET'] ?? '';

$isProd = getenv('NODE_ENV') === 'production';
$num_workers = $isProd ? (int)shell_exec('nproc') * 3 : 2;

/* ---------------- LOAD EXTENSIONS ---------------- */

$STATE = [];


$manifestPath = realpath(__DIR__ . "/../../extension-data.json");

if (!$manifestPath || !file_exists($manifestPath)) {
    echo "[PHP Runner] No extension manifest found\n";
} else {
    $manifest = json_decode(file_get_contents($manifestPath), true);

    foreach ($manifest as $extName => $meta) {
        $sourceDir = $meta['sourceDir'] ?? null;
        if (!$sourceDir) {
            echo "[PHP Runner] No sourceDir for $extName\n";
            continue;
        }

        $cmdFile = $sourceDir . "/command.php";
        if (!file_exists($cmdFile)) {
            continue;
        }

        require_once $cmdFile;

        $fn = strtolower(str_replace("-", "_", $extName));
        if (is_callable($fn)) {
            $STATE[$extName] = $fn;
            echo "[PHP Runner] Loaded $extName\n";
        } else {
            echo "[PHP Runner] Function $fn not found for $extName\n";
        }
    }
}


/* ---------------- SWOOLE SERVER ---------------- */

$server = new Server($host, $pe_port);
$server->set([
    'worker_num' => $num_workers,
    'enable_coroutine' => true,
]);

$server->on("Receive", function ($server, $fd, $reactorId, $data) use (&$STATE, $VALID_API_KEY) {

    // Worker-level TCP state
    static $buffers = [];
    static $auth = [];

    $buffers[$fd] = ($buffers[$fd] ?? '') . $data;

    while (($pos = strpos($buffers[$fd], "\n")) !== false) {

        $line = substr($buffers[$fd], 0, $pos);
        $buffers[$fd] = substr($buffers[$fd], $pos + 1);

        if ($line === '') continue;

        // ONE coroutine per REQUEST
        Coroutine::create(function () use (
            $server, $fd, $line, &$STATE, $VALID_API_KEY, &$auth
        ) {

            $ctx = Coroutine::getContext();

            $type = $line[0];
            $raw  = substr($line, 1);

            $payload = json_decode($raw, true, 512, JSON_INVALID_UTF8_SUBSTITUTE);
            if (json_last_error() !== JSON_ERROR_NONE) {
                $server->send($fd, "{\"error\":\"invalid_json\"}\n");
                return;
            }

            /* ---------- AUTH ---------- */

            if ($type === 'c') {
                if (($payload['apiKey'] ?? '') === $VALID_API_KEY) {
                    $auth[$fd] = true;
                    $server->send($fd, "{\"status\":\"OK\"}\n");
                } else {
                    $server->send($fd, "{\"error\":\"invalid_api_key\"}\n");
                    $server->close($fd);
                }
                return;
            }

            if (empty($auth[$fd])) {
                $server->send($fd, "{\"error\":\"not_authenticated\"}\n");
                return;
            }

            /* ---------- RUN ---------- */

            if ($type === 'r') {
                $fn = $payload['functionName'] ?? '';
                $context = $payload['context'] ?? [];
                $args    = $payload['args'] ?? [];

                if (!isset($STATE[$fn])) {
                     $server->send($fd, json_encode([
                        'fnError' => "not_exist",
                        'c' => $context,
                    ]) . "\n");
                    return;
                }


                try {
                    $result = $STATE[$fn]($args, $context);
                    $server->send($fd, json_encode([
                        'r' => $result,
                        'c' => $context,
                    ]) . "\n");
                } catch (Throwable $e) {
                    $server->send($fd, json_encode([
                        'error' => $e->getMessage()
                    ]) . "\n");
                }
            }
        });
    }
});

$server->start();

