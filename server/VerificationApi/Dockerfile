# Server Dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ./VerificationApi/ ./VerificationApi/
RUN dotnet restore ./VerificationApi/VerificationApi.csproj
RUN dotnet publish ./VerificationApi/VerificationApi.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
# Demo secrets (override in compose env)
ENV DEMO_JWT_KEY=DemoJwtKey_ChangeMe1234567890
ENV DEMO_UPLOAD_SECRET=UploadSecret_ChangeMe
ENTRYPOINT ["dotnet", "VerificationApi.dll"]
