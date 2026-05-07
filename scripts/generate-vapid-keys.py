#!/usr/bin/env python3
from __future__ import annotations

import base64

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


private_key = ec.generate_private_key(ec.SECP256R1())
private_value = private_key.private_numbers().private_value.to_bytes(32, "big")
public_bytes = private_key.public_key().public_bytes(
    Encoding.X962,
    PublicFormat.UncompressedPoint,
)

print(f"VAPID_PUBLIC_KEY={b64url(public_bytes)}")
print(f"VAPID_PRIVATE_KEY={b64url(private_value)}")
print("VAPID_SUBJECT=mailto:admin@example.com")
