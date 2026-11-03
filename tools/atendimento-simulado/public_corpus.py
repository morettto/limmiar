"""Download licensed research PDFs using PMC's documented ESearch/S3 pipeline."""

import argparse
import hashlib
import io
import json
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/simulacao-100/materiais'
S3 = 'https://pmc-oa-opendata.s3.amazonaws.com/'
THEMES = {
    'trauma': '((PTSD[Title] OR "posttraumatic stress"[Title]) AND (psychotherapy OR treatment))',
    'ansiedade_panico': '(("panic disorder"[Title] OR "generalized anxiety"[Title]) AND (therapy OR treatment))',
    'depressao': '(depression[Title] AND (psychotherapy[Title] OR "cognitive behavioral"[Title]))',
    'toc': '(("obsessive compulsive"[Title] OR "obsessive-compulsive"[Title]) AND (therapy OR treatment))',
    'insonia': '(insomnia[Title] AND ("cognitive behavioral" OR psychotherapy))',
    'luto': '((grief[Title] OR bereavement[Title]) AND (therapy OR intervention OR treatment))',
    'ansiedade_social': '("social anxiety"[Title] AND (therapy OR treatment))',
    'dependencia': '((addiction[Title] OR "substance use"[Title]) AND (psychotherapy OR "cognitive behavioral" OR "motivational interviewing"))',
    'transtornos_alimentares': '(("eating disorder"[Title] OR anorexia[Title] OR bulimia[Title]) AND (psychotherapy OR treatment))',
    'estresse_burnout': '((burnout[Title] OR "occupational stress"[Title]) AND (intervention OR mindfulness OR therapy))',
}


def get(url, **kwargs):
    for attempt in range(5):
        try:
            response = requests.get(url, timeout=90, headers={'User-Agent': 'Limmiar-public-research-corpus/1.0'}, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def object_bytes(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 's3' or parsed.netloc != 'pmc-oa-opendata':
        raise ValueError('Unexpected PMC storage URL')
    data = get(S3 + parsed.path.lstrip('/')).content
    expected = urllib.parse.parse_qs(parsed.query).get('md5', [None])[0]
    if not expected or hashlib.md5(data).hexdigest() != expected:
        raise ValueError('PMC object checksum mismatch')
    return data


def article(pmcid, theme):
    listing = ET.fromstring(get(S3, params={'list-type': '2', 'prefix': pmcid + '.', 'delimiter': '/'}).content)
    prefixes = [node.text for node in listing.findall('{*}CommonPrefixes/{*}Prefix')]
    candidates = []
    for prefix in prefixes:
        metadata_url = S3 + 'metadata/' + prefix.rstrip('/') + '.json'
        metadata = get(metadata_url).json()
        if metadata.get('license_code') in {'CC BY', 'CC0'} and metadata.get('pdf_url') and not metadata.get('is_retracted'):
            candidates.append((metadata.get('is_manuscript', True), metadata_url, metadata))
    if not candidates:
        return None
    # Published versions are preferred; version numbers do not identify publication type.
    _, metadata_url, metadata = sorted(candidates, key=lambda row: row[0])[0]
    data = object_bytes(metadata['pdf_url'])
    if not data.startswith(b'%PDF-'):
        raise ValueError('Not a PDF')
    pdf = PdfReader(io.BytesIO(data))
    if not pdf.pages:
        raise ValueError('Empty PDF')
    xml = ET.fromstring(object_bytes(metadata['xml_url']))
    authors = []
    for contributor in xml.findall('.//article-meta/contrib-group/contrib'):
        if contributor.get('contrib-type') == 'author':
            name = ' '.join(''.join(part.itertext()).strip() for part in contributor.findall('name/*'))
            if name:
                authors.append(name)
    if not authors:
        authors = [' '.join(''.join(node.itertext()).split()) for node in xml.findall('.//article-meta/contrib-group/contrib/collab')]
    if not authors:
        raise ValueError('Missing attribution')
    path = OUT / theme / (pmcid + '.pdf')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {**metadata, 'authors': authors, 'theme': theme, 'path': str(path), 'source_url': 'https://pmc.ncbi.nlm.nih.gov/articles/' + pmcid + '/', 'metadata_url': metadata_url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'pages': len(pdf.pages), 'downloaded_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--per-theme', type=int, default=20)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {'source': 'NIH NLM NCBI PubMed Central Article Datasets', 'source_docs': ['https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/', S3 + 'README.txt'], 'notice': 'Research corpus downloaded for a fictional software simulation. Snapshot may not reflect current NLM data. No endorsement by NLM/NIH/HHS.', 'articles': [], 'failures': []}
    records = manifest['articles']
    seen = {row['pmcid'] for row in records}
    hashes = {row['sha256'] for row in records}
    def save():
        temporary = manifest_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), 'utf-8')
        temporary.replace(manifest_path)
    for theme, query in THEMES.items():
        count = sum(row['theme'] == theme for row in records)
        if count >= args.per_theme:
            continue
        time.sleep(0.4)
        result = get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', params={'db': 'pmc', 'term': query + ' AND (cc_by_license[Filter] OR cc0_license[Filter]) AND has_pdf[Filter] NOT pmc_embargo[Filter]', 'retmode': 'json', 'retmax': 150, 'sort': 'relevance'}).json()
        for identifier in result['esearchresult']['idlist']:
            pmcid = 'PMC' + identifier
            if pmcid in seen:
                continue
            try:
                row = article(pmcid, theme)
                if row and row['sha256'] not in hashes:
                    records.append(row)
                    seen.add(pmcid)
                    hashes.add(row['sha256'])
                    count += 1
                    print(f'{theme}: {count}/{args.per_theme} ({len(records)} total) {pmcid}', flush=True)
                    save()
            except Exception as error:
                manifest['failures'].append({'pmcid': pmcid, 'theme': theme, 'error': str(error)})
                save()
            if count >= args.per_theme:
                break
        if count < args.per_theme:
            raise RuntimeError(f'Insufficient eligible PDFs for {theme}: {count}')
    assert len(seen) == len(records) == len(hashes)
    for row in records:
        assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest() == row['sha256']
    save()
    print(json.dumps({'downloaded': len(records), 'failures': len(manifest['failures']), 'manifest': str(manifest_path)}), flush=True)


if __name__ == '__main__':
    main()
