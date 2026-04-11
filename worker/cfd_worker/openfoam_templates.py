from __future__ import annotations

from pathlib import Path


def build_case_files(case_dir: Path, geometry_name: str, core_count: int) -> dict[Path, str]:
    return {
        case_dir / "system" / "controlDict": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class dictionary;
    object controlDict;
}}
application simpleFoam;
startFrom startTime;
startTime 0;
stopAt endTime;
endTime 120;
deltaT 1;
writeControl timeStep;
writeInterval 20;
purgeWrite 2;
functions
{{
    forceCoeffs
    {{
        type forceCoeffs;
        libs ("libforces.so");
        patches ("{geometry_name}");
        rho rhoInf;
        rhoInf 1.225;
        CofR (0 0 0);
        liftDir (0 1 0);
        dragDir (1 0 0);
        pitchAxis (0 0 1);
        magUInf 30;
        lRef 1;
        Aref 1;
    }}
}}
""",
        case_dir / "system" / "fvSchemes": """FoamFile
{
    version 2.0;
    format ascii;
    class dictionary;
    object fvSchemes;
}
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes
{
    default none;
    div(phi,U) bounded Gauss upwind;
    div(phi,k) bounded Gauss upwind;
    div(phi,omega) bounded Gauss upwind;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
wallDist
{
    method meshWave;
}
""",
        case_dir / "system" / "fvSolution": """FoamFile
{
    version 2.0;
    format ascii;
    class dictionary;
    object fvSolution;
}
solvers
{
    p { solver GAMG; tolerance 1e-7; relTol 0.1; smoother GaussSeidel; }
    "(U|k|omega)" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.1; }
}
SIMPLE { nNonOrthogonalCorrectors 0; residualControl { p 1e-3; U 1e-4; "(k|omega)" 1e-4; } }
relaxationFactors { fields { p 0.3; } equations { U 0.7; k 0.7; omega 0.7; } }
""",
        case_dir / "system" / "blockMeshDict": """FoamFile
{
    version 2.0;
    format ascii;
    class dictionary;
    object blockMeshDict;
}
convertToMeters 1;
vertices
(
    (-6 -3 -3) (12 -3 -3) (12 3 -3) (-6 3 -3)
    (-6 -3 3) (12 -3 3) (12 3 3) (-6 3 3)
);
blocks
(
    hex (0 1 2 3 4 5 6 7) (60 24 24) simpleGrading (1 1 1)
);
boundary
(
    inlet { type patch; faces ((0 4 7 3)); }
    outlet { type patch; faces ((1 2 6 5)); }
    left { type symmetryPlane; faces ((0 3 2 1)); }
    right { type symmetryPlane; faces ((4 5 6 7)); }
    bottom { type symmetryPlane; faces ((0 1 5 4)); }
    top { type symmetryPlane; faces ((3 7 6 2)); }
);
""",
        case_dir / "system" / "snappyHexMeshDict": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class dictionary;
    object snappyHexMeshDict;
}}
castellatedMesh true;
snap true;
addLayers false;
mergeTolerance 1e-6;
geometry
{{
    {geometry_name}
    {{
        type triSurfaceMesh;
        file "{geometry_name}.stl";
        name {geometry_name};
    }}
}}
castellatedMeshControls
{{
    maxLocalCells 500000;
    maxGlobalCells 2000000;
    minRefinementCells 10;
    nCellsBetweenLevels 3;
    features
    (
    );
    refinementSurfaces
    {{
        {geometry_name}
        {{
            level (2 3);
            patchInfo
            {{
                type wall;
            }}
        }}
    }}
    resolveFeatureAngle 30;
    refinementRegions
    {{
    }}
    locationInMesh (-5 0 0);
    allowFreeStandingZoneFaces true;
}}
snapControls {{ nSmoothPatch 3; tolerance 2.0; nSolveIter 30; nRelaxIter 5; }}
meshQualityControls
{{
    maxNonOrtho 65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave 80;
    minFlatness 0.5;
    minVol 1e-13;
    minTetQuality 1e-15;
    minArea -1;
    minTwist 0.02;
    minDeterminant 0.001;
    minFaceWeight 0.02;
    minVolRatio 0.01;
    minTriangleTwist -1;
    nSmoothScale 4;
    errorReduction 0.75;
}}
""",
        case_dir / "system" / "decomposeParDict": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class dictionary;
    object decomposeParDict;
}}
numberOfSubdomains {core_count};
method scotch;
""",
        case_dir / "constant" / "physicalProperties": """FoamFile
{
    version 2.0;
    format ascii;
    class dictionary;
    object physicalProperties;
}
viscosityModel constant;
nu 1.5e-05;
""",
        case_dir / "constant" / "momentumTransport": """FoamFile
{
    version 2.0;
    format ascii;
    class dictionary;
    object momentumTransport;
}
simulationType RAS;
RAS
{
    RASModel kOmegaSST;
    turbulence on;
    printCoeffs on;
}
""",
        case_dir / "0" / "U": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class volVectorField;
    object U;
}}
dimensions [0 1 -1 0 0 0 0];
internalField uniform (30 0 0);
boundaryField
{{
    inlet {{ type fixedValue; value uniform (30 0 0); }}
    outlet {{ type zeroGradient; }}
    left {{ type symmetryPlane; }}
    right {{ type symmetryPlane; }}
    bottom {{ type symmetryPlane; }}
    top {{ type symmetryPlane; }}
    {geometry_name} {{ type noSlip; }}
}}
""",
        case_dir / "0" / "p": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class volScalarField;
    object p;
}}
dimensions [0 2 -2 0 0 0 0];
internalField uniform 0;
boundaryField
{{
    inlet {{ type zeroGradient; }}
    outlet {{ type fixedValue; value uniform 0; }}
    left {{ type symmetryPlane; }}
    right {{ type symmetryPlane; }}
    bottom {{ type symmetryPlane; }}
    top {{ type symmetryPlane; }}
    {geometry_name} {{ type zeroGradient; }}
}}
""",
        case_dir / "0" / "k": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class volScalarField;
    object k;
}}
dimensions [0 2 -2 0 0 0 0];
internalField uniform 0.135;
boundaryField
{{
    inlet {{ type fixedValue; value uniform 0.135; }}
    outlet {{ type zeroGradient; }}
    left {{ type symmetryPlane; }}
    right {{ type symmetryPlane; }}
    bottom {{ type symmetryPlane; }}
    top {{ type symmetryPlane; }}
    {geometry_name} {{ type kqRWallFunction; value uniform 0.135; }}
}}
""",
        case_dir / "0" / "omega": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class volScalarField;
    object omega;
}}
dimensions [0 0 -1 0 0 0 0];
internalField uniform 100;
boundaryField
{{
    inlet {{ type fixedValue; value uniform 100; }}
    outlet {{ type zeroGradient; }}
    left {{ type symmetryPlane; }}
    right {{ type symmetryPlane; }}
    bottom {{ type symmetryPlane; }}
    top {{ type symmetryPlane; }}
    {geometry_name} {{ type omegaWallFunction; value uniform 100; }}
}}
""",
        case_dir / "0" / "nut": f"""FoamFile
{{
    version 2.0;
    format ascii;
    class volScalarField;
    object nut;
}}
dimensions [0 2 -1 0 0 0 0];
internalField uniform 0;
boundaryField
{{
    inlet {{ type calculated; value uniform 0; }}
    outlet {{ type calculated; value uniform 0; }}
    left {{ type symmetryPlane; }}
    right {{ type symmetryPlane; }}
    bottom {{ type symmetryPlane; }}
    top {{ type symmetryPlane; }}
    {geometry_name} {{ type nutkWallFunction; value uniform 0; }}
}}
""",
    }
