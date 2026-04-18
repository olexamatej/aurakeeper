from __future__ import annotations


def build_invoice_summary(invoice: dict[str, object]) -> str:
    customer = invoice["customer"]
    name = customer["name"]  # type: ignore[index]
    return f"Invoice {invoice['id']} for {name}"
