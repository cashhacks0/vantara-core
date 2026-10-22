from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .core.config import VERSION, get_settings
from .providers.ollama import OllamaProvider


def create_app(provider=None) -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="VANTARA LOCAL AI", version=VERSION)
    app.state.provider = provider or OllamaProvider(settings.runtime_url)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type"])
    app.include_router(router)
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("app.main:app", host=s.host, port=s.port)
