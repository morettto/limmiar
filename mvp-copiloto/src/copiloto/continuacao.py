import base64
import hashlib
import hmac
import json
import secrets

_SEGREDO = secrets.token_bytes(32)


def _assinatura(posicao: bytes, vinculo: dict) -> bytes:
    consulta = json.dumps(vinculo, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return hmac.digest(_SEGREDO, hashlib.sha256(consulta).digest() + posicao, "sha256")


def emitir(posicao: int, vinculo: dict) -> str:
    if type(posicao) is not int or not 0 < posicao < 2**32:
        raise ValueError("Posição de continuação inválida")
    dados = posicao.to_bytes(4, "big")
    return base64.urlsafe_b64encode(dados + _assinatura(dados, vinculo)).decode()


def abrir(token: str, vinculo: dict) -> int:
    try:
        if not isinstance(token, str) or len(token) != 48:
            raise ValueError("Tamanho inválido")
        dados = base64.b64decode(token, altchars=b"-_", validate=True)
        posicao = int.from_bytes(dados[:4], "big")
        if not posicao or not hmac.compare_digest(dados[4:], _assinatura(dados[:4], vinculo)):
            raise ValueError("Assinatura inválida")
        return posicao
    except (ValueError, UnicodeEncodeError) as erro:
        raise ValueError("Continuação inválida para esta consulta") from erro
