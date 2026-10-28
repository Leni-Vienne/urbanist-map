"""Tag copying compatible with stock and patched pyosmium builds."""


def tags_to_dict(tags):
    """Prefer the optional native bulk copy, falling back to tag iteration."""
    to_dict = getattr(tags, 'to_dict', None)
    if to_dict is not None:
        return to_dict()
    return {tag.k: tag.v for tag in tags}
