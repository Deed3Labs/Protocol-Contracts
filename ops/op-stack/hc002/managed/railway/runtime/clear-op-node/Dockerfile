FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:latest

WORKDIR /workspace
COPY rollup.json /workspace/rollup.json
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
