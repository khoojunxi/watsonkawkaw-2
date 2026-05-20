

THEME 3: Automated PV Layout Design Software
Problem Statement
Rooftop solar photovoltaic (PV) installation in Malaysia is expanding rapidly across
residential and commercial sectors, supported by policies such as Accelerated Transition
Action Programme (ATAP). However, PV layout design remains largely semimanual and
dependent on engineering experience. Designers must interpret roof drawings or site
photos, estimate dimensions, account for obstacles such as water tanks or parapet walls,
determine optimal tilt and azimuth angles, evaluate shading impact, and configure inverter
sizing.
This manual workflow introduces inefficiencies and technical risks. Poor layout planning may
result in underutilised roof area, suboptimal system capacity, reduced energy yield, and
inaccurate return-on-investment projections. Design errors can also lead to material
mismatch and costly site revisions.
The core challenge is the absence of an intelligent, automated design system capable of
generating optimised PV layouts directly from site images while incorporating geometric
constraints, orientation, irradiance data, and electrical design logic. The proposed solution
aims to develop an optimisation-based PV layout engine integrated with Malaysian
irradiance databases to improve design speed, consistency, and energy performance
prediction
Existing Infrastructure (Category)
a. Rooftop Solar PV System
b. Solar Panel Modules
c. Roof Structure & Architecture Drawings
d. Inverter Systems
e. Shading & Irradiance Data
f. Solar Yield Estimation Tools
Background
In current practice, rooftop PV layout planning requires manual measurement, CAD drafting,
obstacle marking, spacing verification, and separate energy yield simulation using tools
such as PVsyst. This process can take one to three hours per small residential project and
longer for commercial installations. Human estimation errors may lead to incorrect module
count or inverter mismatch.
An automated PV layout system that accepts a roof image and minimal site parameters can
significantly reduce design time while maintaining engineering reliability. The system should
be capable of:
a. Detecting usable roof boundaries from the uploaded image
b. Identifying obstacles through image processing

c. Allowing user-defined north orientation alignment
d. Optimising module placement based on spacing rules and tilt assumptions
e. Estimating total installed capacity (kWp)
f. Calculating expected annual energy yield using Malaysian irradiance data
Such automation is particularly relevant in Malaysia, where rooftop solar economics depend
on accurate yield estimation under the ATAP mechanism and local climatic conditions such
as high irradiance and temperature derating effects.
Expected Deliverables
The proposed MVP must demonstrate the following functional capabilities:
a. The software generates an optimised panel placement layout from an uploaded roof
image
b. It calculates total installed capacity in kWp based on selected module specifications.
(Assuming 620kWp Panel - Any Brand)
c. It estimates annual energy yield using Malaysian irradiance data and performance
assumptions.
d. It demonstrates optimisation logic for maximising roof utilisation while respecting
spacing and obstacle constraints.
Each team must propose ONE functional MVP or simulation-based solution.
Mode of Deliverables
a. Working MVP Prototype
b. Demo Video
c. Technical Report (Encouraged)
Notes: Students may use any suitable programming language or development platform,
choice of language is flexible as long as the engineering logic and Malaysian assumptions
are properly implemented.