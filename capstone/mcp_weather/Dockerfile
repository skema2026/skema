FROM python:3.10-slim
RUN pip install requests
WORKDIR /app
COPY weather_mcp_server.py .
EXPOSE 7001
CMD ["python","weather_mcp_server.py"]
