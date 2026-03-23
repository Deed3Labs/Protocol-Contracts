FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-batcher:latest

WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
