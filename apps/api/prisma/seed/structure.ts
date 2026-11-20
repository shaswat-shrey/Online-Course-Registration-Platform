/**
 * University structure and calendar seed (DATABASE.md §10). Idempotent: records
 * are looked up by natural key (codes, labels, names) and only created when
 * missing, so edits made through the admin UI survive re-seeding.
 */
import type {
  CourseCategory,
  DegreeLevel,
  RequirementKind,
  SessionStatus,
  SessionType,
} from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';

const CAMPUSES = [
  { code: 'MAIN', name: 'Main Campus', city: 'Bengaluru', address: '1 University Avenue' },
  { code: 'NORTH', name: 'North Campus', city: 'Bengaluru', address: '42 Hebbal Ring Road' },
];

const SCHOOLS: Array<{
  code: string;
  name: string;
  campus: string;
  departments: Array<[string, string]>;
}> = [
  {
    code: 'ENG',
    name: 'Faculty of Engineering',
    campus: 'MAIN',
    departments: [
      ['SE', 'Software Engineering'],
      ['CS', 'Computer Science'],
      ['EE', 'Electrical Engineering'],
      ['ME', 'Mechanical Engineering'],
      ['EL', 'Electronics Engineering'],
      ['ECE', 'Electronics and Communication Engineering'],
      ['CE', 'Civil Engineering'],
      ['CHE', 'Chemical Engineering'],
      ['AE', 'Aerospace Engineering'],
      ['BME', 'Biomedical Engineering'],
      ['AIDS', 'Artificial Intelligence and Data Science'],
      ['RA', 'Robotics and Automation Engineering'],
    ],
  },
  {
    code: 'SCI',
    name: 'Faculty of Science',
    campus: 'MAIN',
    departments: [
      ['BIO', 'Biology'],
      ['CHEM', 'Chemistry'],
      ['PHY', 'Physics'],
      ['MATH', 'Mathematics'],
    ],
  },
  { code: 'LAW', name: 'Faculty of Law', campus: 'NORTH', departments: [['LAWS', 'Law']] },
  {
    code: 'ART',
    name: 'Faculty of Arts and Humanities',
    campus: 'NORTH',
    departments: [
      ['LIBA', 'Liberal Arts'],
      ['ENGL', 'English'],
      ['HIST', 'History'],
      ['PHIL', 'Philosophy'],
      ['FA', 'Fine Arts'],
      ['LING', 'Linguistics'],
    ],
  },
  {
    code: 'SOC',
    name: 'Faculty of Social Sciences',
    campus: 'NORTH',
    departments: [
      ['ECON', 'Economics'],
      ['POL', 'Political Science'],
      ['SOCI', 'Sociology'],
    ],
  },
  {
    code: 'BUS',
    name: 'Faculty of Business and Management',
    campus: 'MAIN',
    departments: [
      ['MGMT', 'Management Studies'],
      ['COMM', 'Commerce'],
    ],
  },
  {
    code: 'MED',
    name: 'Faculty of Medicine and Health Sciences',
    campus: 'NORTH',
    departments: [
      ['MEDI', 'Medicine'],
      ['NURS', 'Nursing'],
    ],
  },
  {
    code: 'EDU',
    name: 'Faculty of Education',
    campus: 'NORTH',
    departments: [['EDUC', 'Education']],
  },
  {
    code: 'ARC',
    name: 'Faculty of Architecture and Design',
    campus: 'MAIN',
    departments: [['ARCH', 'Architecture']],
  },
];

const DEGREES: Array<[string, string, DegreeLevel]> = [
  ['BTECH', 'Bachelor of Technology', 'UNDERGRADUATE'],
  ['BE', 'Bachelor of Engineering', 'UNDERGRADUATE'],
  ['BSC', 'Bachelor of Science', 'UNDERGRADUATE'],
  ['BA', 'Bachelor of Arts', 'UNDERGRADUATE'],
  ['LLB', 'Bachelor of Laws', 'UNDERGRADUATE'],
  ['BBA', 'Bachelor of Business Administration', 'UNDERGRADUATE'],
  ['BCOM', 'Bachelor of Commerce', 'UNDERGRADUATE'],
  ['BARCH', 'Bachelor of Architecture', 'UNDERGRADUATE'],
  ['MBBS', 'Bachelor of Medicine and Bachelor of Surgery', 'UNDERGRADUATE'],
  ['BED', 'Bachelor of Education', 'UNDERGRADUATE'],
  ['MSC', 'Master of Science', 'POSTGRADUATE'],
  ['MTECH', 'Master of Technology', 'POSTGRADUATE'],
  ['MA', 'Master of Arts', 'POSTGRADUATE'],
  ['MBA', 'Master of Business Administration', 'POSTGRADUATE'],
  ['LLM', 'Master of Laws', 'POSTGRADUATE'],
  ['PHD', 'Doctor of Philosophy', 'DOCTORAL'],
];

type Group = {
  name: string;
  kind: RequirementKind;
  minCredits?: number;
  category?: CourseCategory;
};
interface ProgramSeed {
  code: string;
  name: string;
  degree: string;
  dept: string;
  years: number;
  sessions: number;
  credits: number;
  core?: number;
  elective?: number;
  specializations?: Array<[string, string]>;
  groups?: Group[];
  specGroups?: Group[];
}

const ENGINEERING_GROUPS: Group[] = [
  { name: 'Programme core', kind: 'ALL_OF' },
  {
    name: 'Laboratory courses',
    kind: 'CREDITS_FROM_CATEGORY',
    minCredits: 12,
    category: 'LABORATORY',
  },
  { name: 'Department electives', kind: 'CREDITS_FROM_LIST', minCredits: 24 },
  { name: 'Open electives', kind: 'CREDITS_ANY', minCredits: 12 },
  { name: 'Capstone project', kind: 'CREDITS_FROM_CATEGORY', minCredits: 8, category: 'PROJECT' },
];
const SCIENCE_GROUPS: Group[] = [
  { name: 'Major core', kind: 'ALL_OF' },
  { name: 'Major electives', kind: 'CREDITS_FROM_CATEGORY', minCredits: 18, category: 'ELECTIVE' },
  {
    name: 'General education',
    kind: 'CREDITS_FROM_CATEGORY',
    minCredits: 12,
    category: 'GENERAL_EDUCATION',
  },
  { name: 'Open electives', kind: 'CREDITS_ANY', minCredits: 9 },
];
const SPEC_GROUPS: Group[] = [
  { name: 'Specialization core', kind: 'ALL_OF' },
  { name: 'Specialization electives', kind: 'CREDITS_FROM_LIST', minCredits: 9 },
];

const btech = (dept: string, name: string, extra: Partial<ProgramSeed> = {}): ProgramSeed => ({
  code: `BTECH-${dept}`,
  name: `B.Tech in ${name}`,
  degree: 'BTECH',
  dept,
  years: 4,
  sessions: 8,
  credits: 160,
  core: 100,
  elective: 36,
  groups: ENGINEERING_GROUPS,
  ...extra,
});
const be = (dept: string, name: string): ProgramSeed => ({
  ...btech(dept, name),
  code: `BE-${dept}`,
  name: `B.E. in ${name}`,
  degree: 'BE',
});

const PROGRAMS: ProgramSeed[] = [
  btech('CS', 'Computer Science', {
    specializations: [
      ['AIML', 'Artificial Intelligence and Machine Learning'],
      ['CYBER', 'Cybersecurity'],
      ['CLOUD', 'Cloud Computing'],
    ],
    specGroups: SPEC_GROUPS,
  }),
  btech('SE', 'Software Engineering'),
  btech('AIDS', 'Artificial Intelligence and Data Science'),
  btech('ECE', 'Electronics and Communication Engineering'),
  btech('EE', 'Electrical Engineering'),
  btech('RA', 'Robotics and Automation Engineering'),
  be('ME', 'Mechanical Engineering'),
  be('CE', 'Civil Engineering'),
  be('CHE', 'Chemical Engineering'),
  be('AE', 'Aerospace Engineering'),
  be('BME', 'Biomedical Engineering'),
  be('EL', 'Electronics Engineering'),
  {
    code: 'BSC-BIO',
    name: 'B.Sc. in Biology',
    degree: 'BSC',
    dept: 'BIO',
    years: 3,
    sessions: 6,
    credits: 120,
    core: 60,
    elective: 30,
    groups: SCIENCE_GROUPS,
    specializations: [
      ['MOLBIO', 'Molecular Biology'],
      ['MICRO', 'Microbiology'],
      ['GENOM', 'Genetics and Genomics'],
      ['BIOTECH', 'Biotechnology'],
      ['ECOENV', 'Ecology and Environmental Biology'],
    ],
    specGroups: SPEC_GROUPS,
  },
  {
    code: 'BSC-CHEM',
    name: 'B.Sc. in Chemistry',
    degree: 'BSC',
    dept: 'CHEM',
    years: 3,
    sessions: 6,
    credits: 120,
    groups: SCIENCE_GROUPS,
  },
  {
    code: 'BSC-PHY',
    name: 'B.Sc. in Physics',
    degree: 'BSC',
    dept: 'PHY',
    years: 3,
    sessions: 6,
    credits: 120,
    groups: SCIENCE_GROUPS,
  },
  {
    code: 'BSC-MATH',
    name: 'B.Sc. in Mathematics',
    degree: 'BSC',
    dept: 'MATH',
    years: 3,
    sessions: 6,
    credits: 120,
    groups: SCIENCE_GROUPS,
  },
  {
    code: 'BA-LIBA',
    name: 'Bachelor of Arts',
    degree: 'BA',
    dept: 'LIBA',
    years: 3,
    sessions: 6,
    credits: 120,
    groups: SCIENCE_GROUPS.map((g) =>
      g.name === 'Major core' ? { ...g, name: 'Humanities core' } : g,
    ),
    specializations: [
      ['ENGLIT', 'English Literature'],
      ['HIST', 'History'],
      ['PHIL', 'Philosophy'],
      ['FINEART', 'Fine Arts'],
      ['LING', 'Linguistics'],
      ['PERFART', 'Performing Arts'],
      ['CREWRIT', 'Creative Writing'],
      ['CULTST', 'Cultural Studies'],
      ['MUSIC', 'Music'],
      ['POLSCI', 'Political Science'],
    ],
    specGroups: SPEC_GROUPS,
  },
  {
    code: 'LLB',
    name: 'Bachelor of Laws',
    degree: 'LLB',
    dept: 'LAWS',
    years: 3,
    sessions: 6,
    credits: 150,
    core: 100,
    groups: [
      { name: 'Compulsory law papers', kind: 'ALL_OF' },
      {
        name: 'Clinical and moot court',
        kind: 'CREDITS_FROM_CATEGORY',
        minCredits: 12,
        category: 'PRACTICAL',
      },
      { name: 'Seminar papers', kind: 'CREDITS_FROM_CATEGORY', minCredits: 6, category: 'SEMINAR' },
      { name: 'Optional papers', kind: 'CREDITS_FROM_LIST', minCredits: 24 },
    ],
    specializations: [
      ['CRIM', 'Criminal Law'],
      ['CORP', 'Corporate Law'],
      ['CONST', 'Constitutional Law'],
      ['INTL', 'International Law'],
      ['IPR', 'Intellectual Property Law'],
      ['CIVIL', 'Civil Law'],
      ['ENVL', 'Environmental Law'],
      ['HRL', 'Human Rights Law'],
    ],
    specGroups: SPEC_GROUPS,
  },
  {
    code: 'BBA',
    name: 'Bachelor of Business Administration',
    degree: 'BBA',
    dept: 'MGMT',
    years: 3,
    sessions: 6,
    credits: 120,
    specializations: [
      ['FIN', 'Finance'],
      ['MKT', 'Marketing'],
      ['HRM', 'Human Resource Management'],
    ],
  },
  {
    code: 'BCOM',
    name: 'Bachelor of Commerce',
    degree: 'BCOM',
    dept: 'COMM',
    years: 3,
    sessions: 6,
    credits: 120,
  },
  {
    code: 'BARCH',
    name: 'Bachelor of Architecture',
    degree: 'BARCH',
    dept: 'ARCH',
    years: 5,
    sessions: 10,
    credits: 250,
  },
  {
    code: 'MBBS',
    name: 'Bachelor of Medicine and Bachelor of Surgery',
    degree: 'MBBS',
    dept: 'MEDI',
    years: 5.5,
    sessions: 9,
    credits: 280,
  },
  {
    code: 'BED',
    name: 'Bachelor of Education',
    degree: 'BED',
    dept: 'EDUC',
    years: 2,
    sessions: 4,
    credits: 80,
  },
  {
    code: 'MSC-BIO',
    name: 'M.Sc. in Biology',
    degree: 'MSC',
    dept: 'BIO',
    years: 2,
    sessions: 4,
    credits: 80,
  },
  {
    code: 'MSC-MATH',
    name: 'M.Sc. in Mathematics',
    degree: 'MSC',
    dept: 'MATH',
    years: 2,
    sessions: 4,
    credits: 80,
  },
  {
    code: 'MTECH-CS',
    name: 'M.Tech in Computer Science',
    degree: 'MTECH',
    dept: 'CS',
    years: 2,
    sessions: 4,
    credits: 64,
  },
  {
    code: 'MA-ECON',
    name: 'M.A. in Economics',
    degree: 'MA',
    dept: 'ECON',
    years: 2,
    sessions: 4,
    credits: 80,
  },
  {
    code: 'MA-ENGL',
    name: 'M.A. in English',
    degree: 'MA',
    dept: 'ENGL',
    years: 2,
    sessions: 4,
    credits: 80,
  },
  {
    code: 'MBA',
    name: 'Master of Business Administration',
    degree: 'MBA',
    dept: 'MGMT',
    years: 2,
    sessions: 4,
    credits: 96,
    specializations: [
      ['FIN', 'Finance'],
      ['MKT', 'Marketing'],
      ['OPS', 'Operations Management'],
      ['BA', 'Business Analytics'],
    ],
  },
  {
    code: 'LLM',
    name: 'Master of Laws',
    degree: 'LLM',
    dept: 'LAWS',
    years: 1,
    sessions: 2,
    credits: 40,
  },
  {
    code: 'PHD-CS',
    name: 'Ph.D. in Computer Science',
    degree: 'PHD',
    dept: 'CS',
    years: 3,
    sessions: 6,
    credits: 24,
  },
  {
    code: 'PHD-BIO',
    name: 'Ph.D. in Biology',
    degree: 'PHD',
    dept: 'BIO',
    years: 3,
    sessions: 6,
    credits: 24,
  },
];

/** Instants are authored in the university time zone (IST, UTC+05:30). */
const ist = (local: string) => new Date(`${local}:00+05:30`);
const date = (d: string) => new Date(`${d}T00:00:00.000Z`);

const SCALES = [
  {
    name: 'Example 10-point scale',
    description:
      'EXAMPLE seed data showing a 10-point letter scale. Not an institutional policy: review and adapt before use.',
    entries: [
      ['O', 90, 10, true],
      ['A+', 80, 9, true],
      ['A', 70, 8, true],
      ['B+', 60, 7, true],
      ['B', 55, 6, true],
      ['C', 50, 5, true],
      ['P', 40, 4, true],
      ['F', 0, 0, false],
    ] as const,
  },
  {
    name: 'Example 4.0 letter scale',
    description:
      'EXAMPLE seed data showing a 4.0 letter scale. Not an institutional policy: review and adapt before use.',
    entries: [
      ['A', 93, 4.0, true],
      ['A-', 90, 3.7, true],
      ['B+', 87, 3.3, true],
      ['B', 83, 3.0, true],
      ['B-', 80, 2.7, true],
      ['C+', 77, 2.3, true],
      ['C', 73, 2.0, true],
      ['C-', 70, 1.7, true],
      ['D', 60, 1.0, true],
      ['F', 0, 0, false],
    ] as const,
  },
];

const YEARS = [
  { label: '2025-2026', start: '2025-07-01', end: '2026-06-30' },
  { label: '2026-2027', start: '2026-07-01', end: '2027-06-30' },
];

const SESSIONS: Array<{
  code: string;
  name: string;
  year: string;
  type: SessionType;
  start: string;
  end: string;
  status: SessionStatus;
  current?: boolean;
  period: { opens: string; closes: string; late?: string; addDrop: string; withdrawal: string };
  windows?: Array<{ name: string; opens: string; yearOfStudy: number }>;
}> = [
  {
    code: 'FALL-2025',
    name: 'Fall 2025',
    year: '2025-2026',
    type: 'FALL',
    start: '2025-08-04',
    end: '2025-12-19',
    status: 'COMPLETED',
    period: {
      opens: '2025-07-14T09:00',
      closes: '2025-08-03T23:59',
      addDrop: '2025-08-17T23:59',
      withdrawal: '2025-11-14T23:59',
    },
  },
  {
    code: 'SPRING-2026',
    name: 'Spring 2026',
    year: '2025-2026',
    type: 'SPRING',
    start: '2026-01-12',
    end: '2026-05-22',
    status: 'COMPLETED',
    period: {
      opens: '2025-12-01T09:00',
      closes: '2026-01-11T23:59',
      addDrop: '2026-01-25T23:59',
      withdrawal: '2026-04-17T23:59',
    },
  },
  {
    code: 'FALL-2026',
    name: 'Fall 2026',
    year: '2026-2027',
    type: 'FALL',
    start: '2026-08-03',
    end: '2026-12-18',
    status: 'ACTIVE',
    current: true,
    period: {
      opens: '2026-07-15T09:00',
      closes: '2026-08-02T23:59',
      late: '2026-08-09T23:59',
      addDrop: '2026-08-16T23:59',
      withdrawal: '2026-11-13T23:59',
    },
  },
  {
    code: 'SPRING-2027',
    name: 'Spring 2027',
    year: '2026-2027',
    type: 'SPRING',
    start: '2027-01-11',
    end: '2027-05-21',
    status: 'PLANNED',
    current: true,
    period: {
      opens: '2026-12-01T09:00',
      closes: '2027-01-10T23:59',
      late: '2027-01-17T23:59',
      addDrop: '2027-01-24T23:59',
      withdrawal: '2027-04-16T23:59',
    },
    windows: [
      { name: 'Final-year students', opens: '2026-11-27T09:00', yearOfStudy: 4 },
      { name: 'Third-year students', opens: '2026-11-28T09:00', yearOfStudy: 3 },
    ],
  },
];

export async function seedStructure() {
  const campusIds = new Map<string, string>();
  for (const c of CAMPUSES) {
    const row = await prisma.campus.upsert({ where: { code: c.code }, create: c, update: {} });
    campusIds.set(c.code, row.id);
  }

  const deptIds = new Map<string, string>();
  for (const s of SCHOOLS) {
    const school = await prisma.school.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        name: s.name,
        campusId: campusIds.get(s.campus),
        contactEmail: `${s.code.toLowerCase()}.office@northbridge.example.edu`,
        description: `${s.name} of Northbridge University.`,
      },
      update: {},
    });
    for (const [code, name] of s.departments) {
      const dept = await prisma.department.upsert({
        where: { code },
        create: {
          code,
          name,
          schoolId: school.id,
          campusId: campusIds.get(s.campus),
          contactEmail: `${code.toLowerCase()}@northbridge.example.edu`,
          officeLocation: `${s.code} Block, Room ${100 + s.departments.findIndex(([c]) => c === code) * 10}`,
          description: `Department of ${name}.`,
        },
        update: {},
      });
      deptIds.set(code, dept.id);
    }
  }

  const degreeIds = new Map<string, string>();
  for (const [code, name, level] of DEGREES) {
    const d = await prisma.degree.upsert({
      where: { code },
      create: { code, name, level },
      update: {},
    });
    degreeIds.set(code, d.id);
  }

  let programsCreated = 0;
  for (const p of PROGRAMS) {
    let program = await prisma.program.findUnique({ where: { code: p.code } });
    if (!program) {
      program = await prisma.program.create({
        data: {
          code: p.code,
          name: p.name,
          degreeId: degreeIds.get(p.degree)!,
          departmentId: deptIds.get(p.dept)!,
          durationYears: p.years,
          sessionCount: p.sessions,
          totalCredits: p.credits,
          minCoreCredits: p.core ?? null,
          minElectiveCredits: p.elective ?? null,
          requirementGroups: {
            create: (p.groups ?? []).map((g, position) => ({ ...g, position })),
          },
        },
      });
      programsCreated += 1;
    }
    for (const [code, name] of p.specializations ?? []) {
      const existing = await prisma.specialization.findUnique({
        where: { programId_code: { programId: program.id, code } },
      });
      if (existing) continue;
      await prisma.specialization.create({
        data: {
          programId: program.id,
          code,
          name,
          additionalCredits: p.specGroups ? 18 : null,
          requirementGroups: {
            create: (p.specGroups ?? []).map((g, position) => ({
              ...g,
              name: `${name}: ${g.name.toLowerCase()}`,
              position,
            })),
          },
        },
      });
    }
  }

  const scaleIds = new Map<string, string>();
  for (const s of SCALES) {
    let scale = await prisma.gradingScale.findUnique({ where: { name: s.name } });
    scale ??= await prisma.gradingScale.create({
      data: {
        name: s.name,
        description: s.description,
        entries: {
          create: s.entries.map(([letter, minPercent, gradePoints, isPassing], position) => ({
            letter,
            minPercent,
            gradePoints,
            isPassing,
            position,
          })),
        },
      },
    });
    scaleIds.set(s.name, scale.id);
  }

  const yearIds = new Map<string, string>();
  for (const y of YEARS) {
    const row = await prisma.academicYear.upsert({
      where: { label: y.label },
      create: { label: y.label, startDate: date(y.start), endDate: date(y.end) },
      update: {},
    });
    yearIds.set(y.label, row.id);
  }

  for (const s of SESSIONS) {
    if (await prisma.academicSession.findUnique({ where: { code: s.code } })) continue;
    if (s.current)
      await prisma.academicSession.updateMany({
        where: { type: s.type, isCurrent: true },
        data: { isCurrent: false },
      });
    await prisma.academicSession.create({
      data: {
        code: s.code,
        name: s.name,
        type: s.type,
        status: s.status,
        isCurrent: s.current ?? false,
        academicYearId: yearIds.get(s.year)!,
        startDate: date(s.start),
        endDate: date(s.end),
        gradingScaleId: scaleIds.get('Example 10-point scale'),
        policy: {
          create: {
            minCredits: 12,
            maxCredits: 24,
            maxCreditsWithOverride: 28,
            approvalMode: 'LATE_ONLY',
            waitlistEnabled: true,
            waitlistMaxPerSection: 15,
          },
        },
        registrationPeriod: {
          create: {
            opensAt: ist(s.period.opens),
            closesAt: ist(s.period.closes),
            lateClosesAt: s.period.late ? ist(s.period.late) : null,
            addDropDeadline: ist(s.period.addDrop),
            withdrawalDeadline: ist(s.period.withdrawal),
            priorityWindows: {
              create: (s.windows ?? []).map((w) => ({
                name: w.name,
                opensAt: ist(w.opens),
                yearOfStudy: w.yearOfStudy,
              })),
            },
          },
        },
      },
    });
  }

  return { programsCreated, departments: deptIds };
}
