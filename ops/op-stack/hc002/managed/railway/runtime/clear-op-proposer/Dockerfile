FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-proposer:v1.10.0

WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
