"""Graph validation and deterministic topological ordering."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from .base import NODE_REGISTRY

MAX_NODES = 50
TYPE_COMPATIBLE = {
    "any": {"any", "text", "json", "image", "file", "embedding", "list"},
}


def _compatible(source: str, target: str) -> bool:
    if source == "any" or target == "any" or source == target:
        return True
    if {source, target} == {"list", "text"}:
        return True
    if {source, target} == {"json", "text"}:
        return True
    return False


def validate_graph(graph: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ["Graph must contain node and edge arrays."], warnings
    if not nodes:
        return ["The workflow has no nodes."], warnings
    if len(nodes) > MAX_NODES:
        return [f"The workflow exceeds the {MAX_NODES} node limit."], warnings
    ids: set[str] = set()
    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        node_id = str(node.get("id") or "")
        node_type = node.get("type") or ""
        if not node_id:
            errors.append("A node is missing its id.")
            continue
        if node_id in ids:
            errors.append(f"Duplicate node id '{node_id}'.")
        ids.add(node_id)
        by_id[node_id] = node
        if node_type not in NODE_REGISTRY:
            errors.append(f"Unknown node type '{node_type}'.")
            continue
        instance = NODE_REGISTRY[node_type]
        if instance.spec.disabled:
            errors.append(f"Node '{instance.spec.label}' is disabled by default.")
        for issue in instance.validate(node.get("config") or {}):
            errors.append(f"{instance.spec.label} ({node_id}): {issue}")
    target_ports: set[tuple[str, str]] = set()
    incoming: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source not in by_id or target not in by_id:
            errors.append("An edge references a missing node.")
            continue
        if source == target:
            errors.append(f"Node '{source}' cannot connect to itself.")
            continue
        source_node = NODE_REGISTRY.get(by_id[source].get("type"))
        target_node = NODE_REGISTRY.get(by_id[target].get("type"))
        if not source_node or not target_node:
            continue
        source_port = edge.get("sourceHandle") or edge.get("source_handle") or (source_node.spec.outputs[0].name if source_node.spec.outputs else None)
        target_port = edge.get("targetHandle") or edge.get("target_handle") or (target_node.spec.inputs[0].name if target_node.spec.inputs else None)
        out_spec = next((p for p in source_node.spec.outputs if p.name == source_port), None)
        in_spec = next((p for p in target_node.spec.inputs if p.name == target_port), None)
        if not out_spec:
            errors.append(f"{source_node.spec.label} has no output '{source_port}'.")
            continue
        if not in_spec:
            errors.append(f"{target_node.spec.label} has no input '{target_port}'.")
            continue
        if not _compatible(out_spec.type, in_spec.type):
            errors.append(f"Cannot connect {out_spec.type} output to {in_spec.type} input ({source_node.spec.label} → {target_node.spec.label}).")
        key = (target, target_port)
        if key in target_ports:
            warnings.append(f"Multiple connections target {target_node.spec.label} input '{target_port}'; the last value wins.")
        target_ports.add(key)
        incoming[target].append(source)
    for node in nodes:
        node_type = node.get("type")
        instance = NODE_REGISTRY.get(node_type)
        if not instance:
            continue
        for port in instance.spec.inputs:
            if port.required and (str(node.get("id")), port.name) not in target_ports:
                errors.append(f"{instance.spec.label} requires input '{port.name}'.")
    order = _topo_order(ids, incoming)
    if order is None:
        errors.append("The graph contains a cycle. Cycles are not supported by this executor.")
    return errors, warnings


def _topo_order(ids: set[str], incoming: dict[str, list[str]]) -> list[str] | None:
    indegree = {node_id: 0 for node_id in ids}
    outgoing: dict[str, list[str]] = defaultdict(list)
    for target, sources in incoming.items():
        indegree[target] = len(set(sources))
        for source in set(sources):
            outgoing[source].append(target)
    queue = deque(sorted(node_id for node_id, degree in indegree.items() if degree == 0))
    order: list[str] = []
    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for target in sorted(outgoing[node_id]):
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    return order if len(order) == len(ids) else None


def execution_order(graph: dict[str, Any]) -> list[str]:
    ids = {str(node.get("id")) for node in graph.get("nodes") or []}
    incoming: dict[str, list[str]] = defaultdict(list)
    for edge in graph.get("edges") or []:
        incoming[str(edge.get("target"))].append(str(edge.get("source")))
    return _topo_order(ids, incoming) or []
