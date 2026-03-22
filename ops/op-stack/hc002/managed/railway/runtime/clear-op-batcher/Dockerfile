FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-batcher:v1.13.2

WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
