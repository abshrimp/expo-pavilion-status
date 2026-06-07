<?php
function reservation_register($file, $code, $ipKey, $bid) {
    $fp = fopen($file, 'c+');
    if (!$fp) return null;
    flock($fp, LOCK_EX);

    $contents = stream_get_contents($fp);
    $all = $contents ? json_decode($contents, true) : [];
    if (!is_array($all)) $all = [];

    if (!isset($all[$code])) $all[$code] = ['count' => 0, 'byIp' => [], 'byBid' => []];
    $entry = &$all[$code];

    $isNew = false;
    if ($ipKey !== '' && isset($entry['byIp'][$ipKey])) {
        $rank = $entry['byIp'][$ipKey];
    } elseif ($bid !== '' && isset($entry['byBid'][$bid])) {
        $rank = $entry['byBid'][$bid];
    } else {
        $isNew = true;
        $entry['count'] += 1;
        $rank = $entry['count'];
        if ($ipKey !== '') $entry['byIp'][$ipKey] = $rank;
        if ($bid !== '')   $entry['byBid'][$bid]  = $rank;
    }
    $total = $entry['count'];
    unset($entry);

    if ($isNew) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($all, JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);

    return ['rank' => $rank, 'total' => $total, 'isNew' => $isNew];
}

function client_ip() {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_TRUE_CLIENT_IP'] as $h) {
        if (!empty($_SERVER[$h]) && filter_var($_SERVER[$h], FILTER_VALIDATE_IP)) {
            return $_SERVER[$h];
        }
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]); // 先頭が実クライアント
        if (filter_var($first, FILTER_VALIDATE_IP)) return $first;
    }
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

if (PHP_SAPI !== 'cli') {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['error' => 'POSTのみ対応']);
        exit;
    }

    $data = json_decode(file_get_contents('php://input'), true);
    $code = isset($data['code']) ? (string)$data['code'] : '';
    $bid  = isset($data['bid'])  ? (string)$data['bid']  : '';

    if (!preg_match('/^[A-Za-z0-9]{1,8}$/', $code)) {
        http_response_code(400);
        echo json_encode(['error' => '不正なcode']);
        exit;
    }
    if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $bid)) $bid = ''; // 無効なら無視（IPのみで判定）

    $tz = new DateTimeZone('Asia/Tokyo');
    $today = (new DateTime('now', $tz))->format('Y-m-d');
    $ip = client_ip();
    $ipKey = $ip !== '' ? substr(hash('sha256', $ip . '|expo-reserve'), 0, 16) : ''; // 生IPは保存しない

    $dir = __DIR__ . '/reservations';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
        @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n"); // 直接閲覧禁止
    }
    $file = $dir . '/' . $today . '.json';

    $r = reservation_register($file, $code, $ipKey, $bid);
    if ($r === null) {
        http_response_code(500);
        echo json_encode(['error' => '保存に失敗しました']);
        exit;
    }

    echo json_encode(['ok' => true, 'rank' => $r['rank'], 'total' => $r['total'], 'repeat' => !$r['isNew']], JSON_UNESCAPED_UNICODE);
}
