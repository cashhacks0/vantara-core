/** 3D viewport: grid, sky, lights, objects, transform gizmo, orbit/fly camera. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Edges, FlyControls, Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { useGameStore } from '../state/store';
import type { MeshShape, SceneObject } from '../spec/types';

const DEG = Math.PI / 180;

function ShapeMesh({ shape }: { shape: MeshShape }) {
  if (shape === 'sphere') return <sphereGeometry args={[0.5, 32, 16]} />;
  if (shape === 'cylinder') return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
  if (shape === 'cone') return <coneGeometry args={[0.5, 1, 32]} />;
  if (shape === 'torus') return <torusGeometry args={[0.35, 0.15, 16, 32]} />;
  if (shape === 'plane') return <planeGeometry args={[1, 1]} />;
  return <boxGeometry args={[1, 1, 1]} />;
}

function ObjectView({
  object, material, selected, onSelect,
}: {
  object: SceneObject;
  material?: { color: string; roughness: number; metalness: number; emissive?: string; emissiveIntensity?: number; opacity: number; transparent: boolean };
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
}) {
  if (object.kind === 'light' || object.kind === 'empty') {
    return (
      <group
        position={object.position}
        visible={object.visible}
        onPointerDown={(event) => { event.stopPropagation(); onSelect(object.id, event.nativeEvent.shiftKey); }}
      >
        <mesh>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshBasicMaterial color={object.kind === 'light' ? '#f2b84b' : '#8d8d99'} wireframe />
        </mesh>
        {selected && <Edges scale={1.6} color="#a78bfa" />}
      </group>
    );
  }
  return (
    <group
      position={object.position}
      rotation={[object.rotation[0] * DEG, object.rotation[1] * DEG, object.rotation[2] * DEG]}
      scale={object.scale}
      visible={object.visible}
      onPointerDown={(event) => { event.stopPropagation(); onSelect(object.id, event.nativeEvent.shiftKey); }}
    >
      <mesh castShadow receiveShadow rotation={object.shape === 'plane' ? [-Math.PI / 2, 0, 0] : undefined}>
        <ShapeMesh shape={object.shape ?? 'box'} />
        <meshStandardMaterial
          color={material?.color ?? '#8b5cf6'}
          roughness={material?.roughness ?? 0.6}
          metalness={material?.metalness ?? 0.1}
          emissive={material?.emissive ?? '#000000'}
          emissiveIntensity={material?.emissiveIntensity ?? 0}
          transparent={material?.transparent ?? false}
          opacity={material?.opacity ?? 1}
        />
        {selected && <Edges color="#a78bfa" />}
      </mesh>
    </group>
  );
}

function SceneLights() {
  const spec = useGameStore((state) => state.spec);
  if (!spec) return null;
  return (
    <>
      {spec.lights.map((light) => {
        if (light.kind === 'ambient') return <ambientLight key={light.id} color={light.color} intensity={light.intensity} />;
        if (light.kind === 'hemisphere') return <hemisphereLight key={light.id} color={light.color} groundColor={spec.settings.sky.groundColor} intensity={light.intensity} />;
        if (light.kind === 'point') return <pointLight key={light.id} position={light.position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} />;
        if (light.kind === 'spot') return <spotLight key={light.id} position={light.position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} angle={0.6} penumbra={0.4} />;
        return <directionalLight key={light.id} position={light.position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} shadow-mapSize={[1024, 1024]} />;
      })}
    </>
  );
}

function CameraRig() {
  const cameraMode = useGameStore((state) => state.cameraMode);
  if (cameraMode === 'fly') return <FlyControls movementSpeed={6} rollSpeed={0.6} />;
  return <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.05} />;
}

function PostEffects() {
  const quality = useGameStore((state) => state.spec?.settings.quality ?? 'medium');
  if (quality === 'low') return null;
  return (
    <EffectComposer enableNormalPass={false}>
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Bloom intensity={0.35} luminanceThreshold={0.75} mipmapBlur />
    </EffectComposer>
  );
}

function ActiveObject({ object, material }: { object: SceneObject; material?: SceneObject['light'] }) {
  const gizmoMode = useGameStore((state) => state.gizmoMode);
  const snap = useGameStore((state) => state.snap);
  const preview = useGameStore((state) => state.preview);
  const commit = useGameStore((state) => state.commit);
  const groupRef = useRef<THREE.Group>(null);
  const materialSpec = useGameStore((state) => state.spec?.materials.find((item) => item.id === object.materialId));
  void material;

  const handleUpdate = useCallback(() => {
    const group = groupRef.current;
    if (!group) return;
    preview((draft) => ({
      ...draft,
      objects: draft.objects.map((item) => item.id === object.id ? {
        ...item,
        position: [group.position.x, group.position.y, group.position.z],
        rotation: [group.rotation.x / DEG, group.rotation.y / DEG, group.rotation.z / DEG],
        scale: [group.scale.x, group.scale.y, group.scale.z],
      } : item),
    }));
  }, [object.id, preview]);

  const handleEnd = useCallback(() => {
    const group = groupRef.current;
    if (!group) return;
    commit((draft) => ({
      ...draft,
      objects: draft.objects.map((item) => item.id === object.id ? {
        ...item,
        position: [group.position.x, group.position.y, group.position.z],
        rotation: [group.rotation.x / DEG, group.rotation.y / DEG, group.rotation.z / DEG],
        scale: [group.scale.x, group.scale.y, group.scale.z],
      } : item),
    }));
  }, [object.id, commit]);

  return (
    <TransformControls
      enabled={!object.locked}
      mode={gizmoMode}
      translationSnap={snap ? 0.5 : null}
      rotationSnap={snap ? 15 * DEG : null}
      scaleSnap={snap ? 0.1 : null}
      onObjectChange={handleUpdate}
      onMouseUp={handleEnd}
    >
      <group
        ref={groupRef}
        position={object.position}
        rotation={[object.rotation[0] * DEG, object.rotation[1] * DEG, object.rotation[2] * DEG]}
        scale={object.scale}
      >
        <mesh castShadow receiveShadow>
          <ShapeMesh shape={object.shape ?? 'box'} />
          <meshStandardMaterial
            color={materialSpec?.color ?? '#8b5cf6'}
            roughness={materialSpec?.roughness ?? 0.6}
            metalness={materialSpec?.metalness ?? 0.1}
          />
          <Edges color="#a78bfa" />
        </mesh>
      </group>
    </TransformControls>
  );
}

function SceneContents() {
  const spec = useGameStore((state) => state.spec);
  const selection = useGameStore((state) => state.selection);
  const select = useGameStore((state) => state.select);
  const activeId = selection.length ? selection[selection.length - 1] : null;
  const materials = useMemo(() => new Map((spec?.materials ?? []).map((material) => [material.id, material])), [spec?.materials]);

  if (!spec) return null;
  const handleSelect = (id: string, additive: boolean) => {
    if (additive) {
      select(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
    } else {
      select([id]);
    }
  };

  return (
    <>
      <SceneLights />
      {spec.objects.filter((object) => object.id !== activeId).map((object) => (
        <ObjectView
          key={object.id}
          object={object}
          material={materials.get(object.materialId ?? '')}
          selected={selection.includes(object.id)}
          onSelect={handleSelect}
        />
      ))}
      {spec.objects.filter((object) => object.id === activeId).map((object) => (
        <ActiveObject key={object.id} object={object} />
      ))}
    </>
  );
}

export function Viewport() {
  const spec = useGameStore((state) => state.spec);
  const selection = useGameStore((state) => state.selection);
  const select = useGameStore((state) => state.select);
  const addObject = useGameStore((state) => state.addObject);
  const [dropHint, setDropHint] = useState(false);

  const settings = spec?.settings;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#08080b]"
      onDragOver={(event) => { event.preventDefault(); setDropHint(true); }}
      onDragLeave={() => setDropHint(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropHint(false);
        const payload = event.dataTransfer.getData('application/x-vantara-shape');
        if (!payload) return;
        try {
          const parsed = JSON.parse(payload) as Partial<SceneObject>;
          addObject({ ...parsed, position: [0, 1, 0] });
        } catch { /* ignore malformed drops */ }
      }}
    >
      <Canvas
        shadows={settings?.shadows ?? true}
        dpr={[1, 1.75]}
        camera={{ position: [8, 6, 10], fov: 55, near: 0.1, far: 500 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => select([])}
      >
        <color attach="background" args={[settings?.sky.color ?? '#0b0b12']} />
        {settings?.fog.enabled && (
          <fog attach="fog" args={[settings.fog.color, settings.fog.near, settings.fog.far]} />
        )}
        <SceneContents />
        <Grid
          infiniteGrid
          cellSize={1}
          sectionSize={10}
          cellColor="#1f1f28"
          sectionColor="#2c2c38"
          fadeDistance={120}
          position={[0, 0, 0]}
        />
        <CameraRig />
        <PostEffects />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
        <span className="rounded-md border border-line bg-ink-950/80 px-2 py-1 text-[10px] text-muted">
          {spec?.objects.length ?? 0} objects · {selection.length} selected
        </span>
        {selection.length > 1 && <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] text-accent-soft">Gizmo edits the last selected object</span>}
      </div>

      {dropHint && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-accent/5">
          <div className="rounded-xl border border-dashed border-accent/60 bg-ink-950/80 px-6 py-4 text-center">
            <p className="text-sm font-medium text-ink-50">Drop to add to the scene</p>
            <p className="mt-1 text-[11px] text-muted">The new object is added at the origin and can be moved with the gizmo.</p>
          </div>
        </div>
      )}
    </div>
  );
}
