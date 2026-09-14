"""Cloud entrypoint; prepare/link is not an authorization to run an unconfigured beta."""
import os
import shutil
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(root / 'services'))
    from deployment_config import validate_deployment
    from sponsored_access import validate

    if os.environ.get('EXPRESSION_ENV') != 'production':
        raise SystemExit('Cloud beta requires explicit production configuration.')
    if os.environ.get('EXPRESSION_MODEL_MODE') != 'sponsored':
        raise SystemExit('This internal-beta deployment requires the host-funded model configuration.')
    validate_deployment(os.environ)
    validate(os.environ)
    if not shutil.which(os.environ.get('EXPRESSION_NODE_PATH', 'node')):
        raise SystemExit('The server-side scoring Node runtime is missing.')
    # Current TrainingStore is single-host SQLite WAL. An object-storage mount is not
    # a drop-in replacement. Keep publication closed until a cloud-safe adapter exists.
    raise SystemExit('Cloud persistence adaptation is not complete; do not publish this bundle yet.')


if __name__ == '__main__':
    main()
