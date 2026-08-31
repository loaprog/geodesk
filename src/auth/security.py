from argon2 import PasswordHasher
from argon2.exceptions import (
    VerifyMismatchError,
    VerificationError,
)

ph = PasswordHasher()


def hash_password(p: str) -> str:
    return ph.hash(p)


def verify_password(p: str, h: str) -> bool:
    try:
        return ph.verify(h, p)

    except (VerifyMismatchError, VerificationError):
        return False