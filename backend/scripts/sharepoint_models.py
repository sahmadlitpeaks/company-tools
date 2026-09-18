"""Explicit one-time model installation. Runtime processing never downloads models."""
import argparse
import stanza

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--languages", default="ar,en")
parser.add_argument("--directory", default="./nlp-models")
args = parser.parse_args()
for language in args.languages.split(","):
    language = language.strip()
    if language:
        stanza.download(language, model_dir=args.directory, processors="tokenize,ner", verbose=False)
        # Match the runtime constructor and fail installation if NER is unsupported.
        stanza.Pipeline(lang=language, dir=args.directory, processors="tokenize,ner", download_method=None, use_gpu=False, verbose=False)
        print(f"Privacy recognizer ready: {language}")
