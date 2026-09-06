#!/usr/bin/env python3
"""Normalize generated architecture DOCX/ODT artifacts to US Letter portrait."""

from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile
import re
import sys


def rewrite_archive(path: Path, member: str, transform):
    with ZipFile(path, "r") as source:
        entries = [(item, source.read(item.filename)) for item in source.infolist()]
    with NamedTemporaryFile(dir=path.parent, suffix=path.suffix, delete=False) as temp:
        temp_path = Path(temp.name)
    with ZipFile(temp_path, "w", ZIP_DEFLATED) as target:
        for item, data in entries:
            if item.filename == member:
                data = transform(data.decode("utf-8")).encode("utf-8")
            target.writestr(item, data)
    temp_path.replace(path)


def docx_letter(xml: str) -> str:
    return re.sub(r'<w:pgSz\s+w:w="\d+"\s+w:h="\d+"\s*/>',
                  '<w:pgSz w:w="12240" w:h="15840"/>', xml)


def odt_letter(xml: str) -> str:
    xml = re.sub(r'fo:page-width="[^"]+"', 'fo:page-width="8.5in"', xml)
    return re.sub(r'fo:page-height="[^"]+"', 'fo:page-height="11in"', xml)


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        artifact = Path(arg)
        if artifact.suffix.lower() == ".docx":
            rewrite_archive(artifact, "word/document.xml", docx_letter)
        elif artifact.suffix.lower() == ".odt":
            rewrite_archive(artifact, "styles.xml", odt_letter)
        else:
            raise SystemExit(f"Unsupported document type: {artifact}")
        print(f"Normalized {artifact}")
