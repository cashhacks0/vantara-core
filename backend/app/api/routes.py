from fastapi import APIRouter, Depends, HTTPException, Request

from ..core.config import VERSION, Settings, get_settings
from ..providers.base import InferenceProvider, ProviderError
from ..services.system import system_info

router = APIRouter(prefix="/api")


def get_provider(request: Request) -> InferenceProvider:
    return request.app.state.provider


@router.get("/health")
async def health(provider: InferenceProvider = Depends(get_provider)):
    """Backend status plus runtime connectivity (never fails if runtime is down)."""
    try:
        info = await provider.health_check()
        runtime = {"provider": provider.name, "connected": True, **info}
    except ProviderError as e:
        runtime = {"provider": provider.name, "connected": False, "error": str(e)}
    return {"status": "ok", "version": VERSION, "runtime": runtime}


@router.get("/system")
async def system(settings: Settings = Depends(get_settings)):
    return system_info(settings.data_dir)


@router.get("/models")
async def models(provider: InferenceProvider = Depends(get_provider)):
    try:
        return {"models": await provider.list_models()}
    except ProviderError as e:
        raise HTTPException(status_code=503, detail=str(e))
