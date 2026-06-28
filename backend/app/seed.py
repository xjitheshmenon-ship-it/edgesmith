"""Seed the database with Edgesmith's initial configuration from the CPCMS spec."""
from sqlalchemy.orm import Session
from app.models.users import User, UserRole
from app.models.factory import FactoryLocation, Workstation, StorageLocation, WorkstationCategory
from app.models.cycle import CycleType, CycleVersion, CycleStep
from app.models.product import Size, Design, DesignSizeValidity, ProductType
from app.models.manufacturing import ConversionPattern
from app.auth import hash_password


EAT_STEPS = [
    ("1", "Band Saw Cutting", "BSW-01", "RM", "RM-Q", False, False, False),
    ("2", "UID Tagging", "RCV-01", "RM-Q", "RM-D", False, False, False),
    ("3", "Straightening", "STR-MAN", "RM-D", "MC-Q", False, False, False),
    ("4", "Bunch Grinding", "SG-DLT", "MC-Q", "MC-Q", False, False, False),
    ("5", "OP10 Rough Mill", "MM22", "MC-Q", "MC-D", False, False, False),
    ("6", "Hardening", "HT70", "MC-D", "HT-Q", False, False, False),
    ("7", "Quenching", "HT80", "HT-Q", "HT-Q", False, False, False),
    ("8", "Straightening HYD", "STR-HYD", "HT-Q", "HT-Q", False, False, False),
    ("9", "Temper 1", "HT90", "HT-Q", "HT-Q", False, False, False),
    ("10", "Temper 2", "HT90", "HT-Q", "HT-D", False, False, False),
    ("11", "Straighten Post-HT", "STR-HYD", "HT-D", "MC-Q", False, False, False),
    ("12", "Surface Grind 1", "SG-DLT", "MC-Q", "MC-D", False, False, False),
    ("13", "Anti-rust Coat", "PRO", "MC-D", "MC-D", False, False, False),
    ("14", "Temper 3 Stress Relief", "HT90", "MC-D", "HT-Q", False, False, False),
    ("15", "Straighten Manual", "STR-MAN", "HT-Q", "QC-Q", False, False, False),
    ("16", "Converting", "BSW-02", "QC-Q", "QC-Q", True, False, False),
    ("16B", "Child UID Marking", "RCV-01", "QC-Q", "QC-Q", False, True, False),
    ("17", "OP20 Semi-finish Mill", "MM11", "QC-Q", "MC-Q", False, False, False),
    ("18", "OP30 Finish Mill", "MM11", "MC-Q", "MC-D", False, False, False),
    ("19", "Straighten Post-OP30", "STR-MAN", "MC-D", "QC-Q", False, False, False),
    ("20", "Surface Grind 2", "SG-DLT", "QC-Q", "MC-D", False, False, False),
    ("21", "Anti-rust Coat 2", "PRO", "MC-D", "MC-D", False, False, False),
    ("22", "Bevel Grinding", "AG-ALP", "MC-D", "MC-D", False, False, False),
    ("23", "Final Anti-rust", "PRO", "MC-D", "QC-Q", False, False, False),
    ("24", "Final Straightening", "STR-MAN", "QC-Q", "QC-D", False, False, False),
    ("25", "QC Inspection", "HRC-01", "QC-D", "QC-D", False, False, True),
    ("26", "Packing and Dispatch", "PKG", "QC-D", "FG", False, False, False),
]

WORKSTATIONS = [
    ("BSW-01", "Band Saw 1", WorkstationCategory.cutting),
    ("BSW-02", "Band Saw 2", WorkstationCategory.cutting),
    ("RCV-01", "Receiving / Work Table", WorkstationCategory.other),
    ("HT70", "Hardening Furnace", WorkstationCategory.heat_treatment),
    ("HT80", "Quench Tank", WorkstationCategory.heat_treatment),
    ("HT90", "Tempering Furnace", WorkstationCategory.heat_treatment),
    ("STR-HYD", "Hydraulic Straightener", WorkstationCategory.machining),
    ("STR-MAN", "Manual Straightener", WorkstationCategory.machining),
    ("SG-DLT", "Surface Grinder DLT", WorkstationCategory.grinding),
    ("MM22", "Milling Machine 22 (OP10)", WorkstationCategory.machining),
    ("MM11", "Milling Machine 11 (OP20/30)", WorkstationCategory.machining),
    ("AG-ALP", "Angle Grinder ALP", WorkstationCategory.grinding),
    ("AG-BTA", "Angle Grinder BTA", WorkstationCategory.grinding),
    ("AG-GMM", "Angle Grinder GMM", WorkstationCategory.grinding),
    ("PRO", "Protective Coating Station", WorkstationCategory.coating),
    ("HRC-01", "Hardness Tester / QC Station", WorkstationCategory.qc),
    ("VCL-200", "VCL 200", WorkstationCategory.machining),
    ("ISP", "Inspection Station", WorkstationCategory.qc),
    ("PKG", "Packing and Dispatch", WorkstationCategory.packing),
]

STORAGES = ["RM", "RM-Q", "RM-D", "HT-Q", "HT-D", "MC-Q", "MC-D", "QC-Q", "QC-D", "FG"]


EXTRA_USERS = [
    # 5 operators
    ("operator3", "Muthukumar S",    "op123", UserRole.operator,    1),
    ("operator4", "Vijayakumar R",   "op123", UserRole.operator,    1),
    ("operator5", "Balamurugan K",   "op123", UserRole.operator,    2),
    ("operator6", "Senthilkumar P",  "op123", UserRole.operator,    2),
    ("operator7", "Arumugam D",      "op123", UserRole.operator,    1),
    # 3 supervisors
    ("supervisor3", "Kannan M",      "super123", UserRole.supervisor, 1),
    ("supervisor4", "Prakash V",     "super123", UserRole.supervisor, 2),
    ("supervisor5", "Murugesan T",   "super123", UserRole.supervisor, 1),
]


def seed_extra_users(db: Session):
    """Idempotent — inserts extra users only if they don't already exist."""
    loc1 = db.query(FactoryLocation).filter(FactoryLocation.code == "F1").first()
    loc2 = db.query(FactoryLocation).filter(FactoryLocation.code == "F2").first()
    if not loc1 or not loc2:
        return
    loc_map = {1: loc1.id, 2: loc2.id}
    added = 0
    for username, full_name, pwd, role, loc_idx in EXTRA_USERS:
        if not db.query(User).filter(User.username == username).first():
            db.add(User(
                username=username,
                full_name=full_name,
                hashed_password=hash_password(pwd),
                role=role,
                primary_location_id=loc_map[loc_idx],
            ))
            added += 1
    if added:
        db.commit()
        print(f"Added {added} extra users.")


def seed(db: Session):
    if db.query(User).filter(User.username == "admin").first():
        print("Database already seeded.")
        seed_extra_users(db)
        return

    print("Seeding database...")

    # Factory locations
    loc1 = FactoryLocation(code="F1", name="Factory Location 1")
    loc2 = FactoryLocation(code="F2", name="Factory Location 2")
    db.add_all([loc1, loc2])
    db.flush()

    # Storage locations (shared)
    storage_map = {}
    for code in STORAGES:
        s = StorageLocation(code=code, name=code)
        db.add(s)
        db.flush()
        storage_map[code] = s

    # Workstations (available at both locations — factory_location_id = None)
    ws_map = {}
    for code, name, category in WORKSTATIONS:
        ws = Workstation(code=code, name=name, category=category, factory_location_id=None)
        db.add(ws)
        db.flush()
        ws_map[code] = ws

    # Sizes
    sizes = {}
    for mm in [1500, 1424, 2750]:
        s = Size(value_mm=mm)
        db.add(s)
        db.flush()
        sizes[mm] = s

    # Designs
    plain = Design(code="Plain", description="Plain profile")
    d8534 = Design(code="9/8534", description="Drawing 9/8534")
    d5032 = Design(code="9/5032", description="Drawing 9/5032")
    db.add_all([plain, d8534, d5032])
    db.flush()

    # Design-size validity matrix
    validities = [
        (plain, sizes[1500]), (d8534, sizes[1500]),
        (plain, sizes[1424]), (d5032, sizes[1424]),
        (plain, sizes[2750]), (d8534, sizes[2750]), (d5032, sizes[2750]),
    ]
    for design, size in validities:
        db.add(DesignSizeValidity(design_id=design.id, size_id=size.id))

    # Cycle types
    eat_cycle = CycleType(name="EAT", letter_prefix="E", description="Primary EAT cycle — 26 steps")
    swan_cycle = CycleType(name="SWAN", letter_prefix="S", description="SWAN cycle")
    oven_cycle = CycleType(name="OVEN", letter_prefix="O", description="OVEN cycle")
    db.add_all([eat_cycle, swan_cycle, oven_cycle])
    db.flush()

    # EAT cycle version 1
    eat_v1 = CycleVersion(cycle_type_id=eat_cycle.id, version_number=1, is_current=True, change_notes="Initial EAT cycle from CPCMS spec")
    db.add(eat_v1)
    db.flush()

    for order, (step_num, op_name, ws_code, from_s, to_s, is_conv, is_child, is_qc) in enumerate(EAT_STEPS):
        step = CycleStep(
            cycle_version_id=eat_v1.id,
            step_number=step_num,
            step_order=order,
            operation_name=op_name,
            workstation_id=ws_map[ws_code].id,
            from_storage_id=storage_map[from_s].id,
            to_storage_id=storage_map[to_s].id,
            is_converting_step=is_conv,
            is_child_marking_step=is_child,
            is_qc_step=is_qc,
        )
        db.add(step)

    # Stub SWAN and OVEN (single placeholder step — Admin configures)
    for cycle, prefix in [(swan_cycle, "S"), (oven_cycle, "O")]:
        v = CycleVersion(cycle_type_id=cycle.id, version_number=1, is_current=True, change_notes="Placeholder — Admin must configure steps")
        db.add(v)
        db.flush()
        step = CycleStep(
            cycle_version_id=v.id, step_number="1", step_order=0,
            operation_name="Configure via Admin panel",
            workstation_id=ws_map["RCV-01"].id,
        )
        db.add(step)

    # Conversion patterns
    pat_a = ConversionPattern(name="Pattern A", input_length_mm=4500, output_lengths_mm=[1500, 1500, 1424], kerf_mm=3)
    pat_b = ConversionPattern(name="Pattern B", input_length_mm=3000, output_lengths_mm=[1500, 1424], kerf_mm=3)
    db.add_all([pat_a, pat_b])

    # Default users
    users = [
        User(username="admin", full_name="System Admin", hashed_password=hash_password("admin123"), role=UserRole.admin),
        User(username="manager1", full_name="Ravi Kumar", hashed_password=hash_password("manager123"), role=UserRole.manager),
        User(username="supervisor1", full_name="Anand Pillai", hashed_password=hash_password("super123"), role=UserRole.supervisor, primary_location_id=loc1.id),
        User(username="supervisor2", full_name="Suresh Nair", hashed_password=hash_password("super123"), role=UserRole.supervisor, primary_location_id=loc2.id),
        User(username="operator1", full_name="Rajesh T", hashed_password=hash_password("op123"), role=UserRole.operator, primary_location_id=loc1.id),
        User(username="operator2", full_name="Dinesh M", hashed_password=hash_password("op123"), role=UserRole.operator, primary_location_id=loc2.id),
        User(username="service1", full_name="Field Service", hashed_password=hash_password("svc123"), role=UserRole.service),
        User(username="shopfloor", full_name="Shopfloor Display", hashed_password=hash_password("floor123"), role=UserRole.shopfloor),
    ]
    db.add_all(users)
    db.commit()
    print("Seeding complete.")
