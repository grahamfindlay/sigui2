"""Server-side level-of-detail (LOD) aggregation.

The governing principle (Neuroglancer lesson): the browser main thread never
touches a full-resolution array. The server reduces data to a
viewport-appropriate size *before* it goes on the wire.
"""
