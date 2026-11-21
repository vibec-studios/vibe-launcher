import sys, zipfile

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
    main = None
    for line in zi.read("META-INF/MANIFEST.MF").decode("utf-8", "replace").splitlines():
        if line.startswith("Main-Class:"):
            main = line.split(":", 1)[1].strip()
        if not line.strip():
            break
    mf = "Manifest-Version: 1.0\r\n" + (f"Main-Class: {main}\r\n" if main else "") + "\r\n"
    zo.writestr("META-INF/MANIFEST.MF", mf)
    for info in zi.infolist():
        n = info.filename
        if n == "META-INF/MANIFEST.MF":
            continue
        if n.startswith("META-INF/") and n.count("/") == 1 and n.rsplit(".", 1)[-1].upper() in ("SF", "RSA", "DSA", "EC"):
            continue
        zo.writestr(info, zi.read(n), compress_type=info.compress_type)
print("ok", dst)
