"""Rate limiter simples em memória (sliding window) para proteger endpoints sensíveis,
como o login, contra tentativas de força bruta.

Como a aplicação roda em um único processo (ver docker-compose.yml), um limitador
em memória é suficiente e evita a necessidade de uma dependência externa como Redis.
Se a aplicação passar a rodar em múltiplas réplicas, este módulo deve ser substituído
por um limitador com estado compartilhado (ex.: Redis).
"""

import time
from collections import defaultdict, deque

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 5 * 60  # 5 minutos

_attempts: dict[str, deque] = defaultdict(deque)


def _prune(key: str, now: float) -> None:
    bucket = _attempts[key]
    while bucket and now - bucket[0] > WINDOW_SECONDS:
        bucket.popleft()
    if not bucket:
        _attempts.pop(key, None)


def is_rate_limited(key: str) -> tuple[bool, int]:
    """Retorna (limitado, segundos_para_tentar_novamente)."""
    now = time.time()
    _prune(key, now)
    bucket = _attempts.get(key) or deque()
    if len(bucket) >= MAX_ATTEMPTS:
        retry_after = int(WINDOW_SECONDS - (now - bucket[0])) + 1
        return True, max(retry_after, 1)
    return False, 0


def register_attempt(key: str) -> None:
    _attempts[key].append(time.time())


def reset(key: str) -> None:
    _attempts.pop(key, None)
