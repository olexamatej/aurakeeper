from app import build_invoice_summary


def test_guest_invoice_summary() -> None:
    assert build_invoice_summary({"id": "INV-100"}) == "Invoice INV-100 for Guest"


if __name__ == "__main__":
    test_guest_invoice_summary()
    print("python example tests passed")
