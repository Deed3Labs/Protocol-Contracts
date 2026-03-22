FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:latest

WORKDIR /workspace
COPY genesis.json /workspace/genesis.json
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
