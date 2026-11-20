/**
 * Course catalog, classrooms and sections seed (Phase 5). Deterministic
 * (seeded PRNG) and idempotent: courses and classrooms are keyed by code/room,
 * and a session's sections are only generated when that session has none.
 */
import type {
  ClassroomType,
  CourseCategory,
  MeetingType,
  SectionStatus,
} from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(5_2026_11_20);

/** Eight courses per department, in level order: 101, 102, 201, 202, 301, 302, 401, 402. */
const CATALOG: Record<string, string[]> = {
  SE: [
    'Introduction to Software Engineering',
    'Software Engineering Laboratory',
    'Object-Oriented Design',
    'Software Requirements Engineering',
    'Software Testing and Quality Assurance',
    'Software Architecture',
    'DevOps and Continuous Delivery',
    'Software Engineering Capstone Project',
  ],
  EE: [
    'Basic Electrical Engineering',
    'Electrical Circuits Laboratory',
    'Network Analysis',
    'Electrical Machines',
    'Power Systems',
    'Control Systems',
    'Power Electronics',
    'Electrical Engineering Capstone Project',
  ],
  ME: [
    'Engineering Mechanics',
    'Workshop Practice Laboratory',
    'Thermodynamics',
    'Strength of Materials',
    'Fluid Mechanics',
    'Machine Design',
    'Heat Transfer',
    'Mechanical Engineering Capstone Project',
  ],
  EL: [
    'Electronic Devices',
    'Electronic Devices Laboratory',
    'Analog Circuits',
    'Digital Logic Design',
    'Microprocessors',
    'VLSI Design',
    'Embedded Systems',
    'Electronics Capstone Project',
  ],
  ECE: [
    'Signals and Systems',
    'Communication Laboratory',
    'Analog Communication',
    'Electromagnetic Fields',
    'Digital Communication',
    'Antennas and Wave Propagation',
    'Wireless Networks',
    'Communication Engineering Capstone Project',
  ],
  CE: [
    'Engineering Surveying',
    'Surveying Laboratory',
    'Structural Analysis',
    'Building Materials',
    'Geotechnical Engineering',
    'Transportation Engineering',
    'Design of Steel Structures',
    'Civil Engineering Capstone Project',
  ],
  CHE: [
    'Introduction to Chemical Engineering',
    'Chemical Process Laboratory',
    'Chemical Process Calculations',
    'Mass Transfer',
    'Chemical Reaction Engineering',
    'Process Control',
    'Process Plant Design',
    'Chemical Engineering Capstone Project',
  ],
  AE: [
    'Introduction to Aerospace Engineering',
    'Aerodynamics Laboratory',
    'Aerodynamics',
    'Aircraft Structures',
    'Flight Mechanics',
    'Propulsion',
    'Spacecraft Dynamics',
    'Aerospace Capstone Project',
  ],
  BME: [
    'Introduction to Biomedical Engineering',
    'Biomedical Instrumentation Laboratory',
    'Human Physiology for Engineers',
    'Biomaterials',
    'Medical Imaging',
    'Biomechanics',
    'Medical Device Design',
    'Biomedical Capstone Project',
  ],
  AIDS: [
    'Introduction to Data Science',
    'Data Science Laboratory',
    'Statistical Learning',
    'Data Visualization',
    'Deep Learning',
    'Natural Language Processing',
    'Big Data Systems',
    'AI Capstone Project',
  ],
  RA: [
    'Introduction to Robotics',
    'Robotics Laboratory',
    'Kinematics and Dynamics',
    'Sensors and Actuators',
    'Robot Control',
    'Computer Vision for Robotics',
    'Autonomous Systems',
    'Robotics Capstone Project',
  ],
  BIO: [
    'Cell Biology',
    'Biology Laboratory',
    'Genetics',
    'Microbiology',
    'Molecular Biology',
    'Ecology',
    'Biotechnology',
    'Genomics and Bioinformatics',
  ],
  CHEM: [
    'General Chemistry',
    'Chemistry Laboratory',
    'Organic Chemistry',
    'Inorganic Chemistry',
    'Physical Chemistry',
    'Analytical Chemistry',
    'Spectroscopy',
    'Medicinal Chemistry',
  ],
  PHY: [
    'Mechanics',
    'Physics Laboratory',
    'Electricity and Magnetism',
    'Waves and Optics',
    'Quantum Mechanics',
    'Statistical Physics',
    'Solid State Physics',
    'Nuclear and Particle Physics',
  ],
  LAWS: [
    'Law of Contracts',
    'Legal Methods',
    'Constitutional Law',
    'Law of Torts',
    'Criminal Law',
    'Corporate Law',
    'International Law',
    'Intellectual Property Law',
  ],
  LIBA: [
    'Foundations of Liberal Arts',
    'Academic Writing',
    'Critical Thinking',
    'World Civilizations',
    'Ethics and Society',
    'Cultural Studies',
    'Interdisciplinary Seminar',
    'Liberal Arts Thesis',
  ],
  ENGL: [
    'Introduction to Literature',
    'English Composition',
    'British Literature',
    'American Literature',
    'Postcolonial Literature',
    'Literary Theory',
    'Shakespeare Studies',
    'Creative Writing Workshop',
  ],
  HIST: [
    'World History',
    'Historiography',
    'Ancient India',
    'Medieval Europe',
    'Modern South Asia',
    'History of Science',
    'Colonialism and Decolonization',
    'Research Seminar in History',
  ],
  PHIL: [
    'Introduction to Philosophy',
    'Formal Logic',
    'Ethics',
    'Philosophy of Mind',
    'Epistemology',
    'Metaphysics',
    'Political Philosophy',
    'Seminar in Philosophy',
  ],
  FA: [
    'Drawing Fundamentals',
    'Studio Practice',
    'Art History',
    'Painting',
    'Sculpture',
    'Printmaking',
    'Contemporary Art',
    'Fine Arts Portfolio Project',
  ],
  LING: [
    'Introduction to Linguistics',
    'Phonetics Laboratory',
    'Phonology',
    'Syntax',
    'Semantics',
    'Sociolinguistics',
    'Computational Linguistics',
    'Seminar in Linguistics',
  ],
  ECON: [
    'Principles of Microeconomics',
    'Principles of Macroeconomics',
    'Intermediate Microeconomics',
    'Econometrics',
    'Development Economics',
    'Public Finance',
    'International Trade',
    'Seminar in Economics',
  ],
  POL: [
    'Introduction to Political Science',
    'Indian Government and Politics',
    'Comparative Politics',
    'Political Theory',
    'International Relations',
    'Public Policy',
    'Political Economy',
    'Seminar in Political Science',
  ],
  SOCI: [
    'Introduction to Sociology',
    'Social Research Methods',
    'Social Stratification',
    'Urban Sociology',
    'Gender and Society',
    'Sociology of Development',
    'Sociological Theory',
    'Seminar in Sociology',
  ],
  MGMT: [
    'Principles of Management',
    'Business Communication',
    'Organizational Behaviour',
    'Marketing Management',
    'Financial Management',
    'Operations Management',
    'Strategic Management',
    'Management Capstone Project',
  ],
  COMM: [
    'Financial Accounting',
    'Business Mathematics',
    'Cost Accounting',
    'Business Law',
    'Taxation',
    'Auditing',
    'Corporate Finance',
    'Commerce Research Project',
  ],
  MEDI: [
    'Human Anatomy',
    'Anatomy Dissection Laboratory',
    'Physiology',
    'Biochemistry',
    'Pathology',
    'Pharmacology',
    'Community Medicine',
    'Clinical Medicine',
  ],
  NURS: [
    'Fundamentals of Nursing',
    'Nursing Skills Laboratory',
    'Medical-Surgical Nursing',
    'Community Health Nursing',
    'Pediatric Nursing',
    'Mental Health Nursing',
    'Nursing Research',
    'Nursing Internship',
  ],
  EDUC: [
    'Foundations of Education',
    'Educational Psychology',
    'Curriculum Development',
    'Pedagogy of Science',
    'Assessment and Evaluation',
    'Inclusive Education',
    'Educational Technology',
    'Teaching Internship',
  ],
  ARCH: [
    'Architectural Design I',
    'Architectural Drawing Studio',
    'History of Architecture',
    'Building Construction',
    'Architectural Design III',
    'Environmental Design',
    'Urban Design',
    'Architecture Thesis Project',
  ],
};

type Prereq = Array<Array<string | [string, string]>>;
type CourseSpec = {
  code: string;
  title: string;
  dept: string;
  level: number;
  category: CourseCategory;
  credits: number;
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  prereqs?: Prereq;
  coreqs?: string[];
  description?: string;
};

/** Hand-written Computer Science and Mathematics catalogs with realistic prerequisites. */
const CURATED: CourseSpec[] = [
  { code: 'MATH101', title: 'Calculus I', dept: 'MATH', level: 100, category: 'CORE', credits: 4 },
  {
    code: 'MATH102',
    title: 'Linear Algebra',
    dept: 'MATH',
    level: 100,
    category: 'CORE',
    credits: 4,
  },
  {
    code: 'MATH201',
    title: 'Calculus II',
    dept: 'MATH',
    level: 200,
    category: 'CORE',
    credits: 4,
    prereqs: [['MATH101']],
  },
  {
    code: 'MATH202',
    title: 'Probability and Statistics',
    dept: 'MATH',
    level: 200,
    category: 'CORE',
    credits: 4,
    prereqs: [['MATH101']],
  },
  {
    code: 'MATH203',
    title: 'Differential Equations',
    dept: 'MATH',
    level: 200,
    category: 'CORE',
    credits: 4,
    prereqs: [['MATH201'], ['MATH102']],
  },
  {
    code: 'MATH301',
    title: 'Real Analysis',
    dept: 'MATH',
    level: 300,
    category: 'CORE',
    credits: 4,
    prereqs: [['MATH201']],
  },
  {
    code: 'MATH302',
    title: 'Numerical Methods',
    dept: 'MATH',
    level: 300,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['MATH201'], ['MATH102']],
  },
  {
    code: 'MATH303',
    title: 'Optimization',
    dept: 'MATH',
    level: 300,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['MATH102']],
  },
  {
    code: 'MATH401',
    title: 'Abstract Algebra',
    dept: 'MATH',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['MATH301']],
  },
  {
    code: 'MATH402',
    title: 'Topology',
    dept: 'MATH',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['MATH301']],
  },
  {
    code: 'CS101',
    title: 'Programming Fundamentals',
    dept: 'CS',
    level: 100,
    category: 'CORE',
    credits: 4,
    description:
      'Problem solving and programming in a high-level language: control flow, functions, recursion, arrays and basic data abstraction.',
  },
  {
    code: 'CS102',
    title: 'Programming Laboratory',
    dept: 'CS',
    level: 100,
    category: 'LABORATORY',
    credits: 2,
    coreqs: ['CS101'],
  },
  {
    code: 'CS201',
    title: 'Data Structures',
    dept: 'CS',
    level: 200,
    category: 'CORE',
    credits: 4,
    prereqs: [['CS101']],
    description:
      'Lists, stacks, queues, trees, heaps, hash tables and graphs, with analysis of their operations.',
  },
  {
    code: 'CS202',
    title: 'Discrete Structures',
    dept: 'CS',
    level: 200,
    category: 'CORE',
    credits: 4,
    prereqs: [['MATH101', 'MATH102']],
  },
  {
    code: 'CS203',
    title: 'Computer Organization',
    dept: 'CS',
    level: 200,
    category: 'CORE',
    credits: 4,
    prereqs: [['CS101']],
  },
  {
    code: 'CS204',
    title: 'Data Structures Laboratory',
    dept: 'CS',
    level: 200,
    category: 'LABORATORY',
    credits: 2,
    coreqs: ['CS201'],
  },
  {
    code: 'CS301',
    title: 'Design and Analysis of Algorithms',
    dept: 'CS',
    level: 300,
    category: 'CORE',
    credits: 4,
    prereqs: [['CS201'], ['CS202']],
  },
  {
    code: 'CS302',
    title: 'Operating Systems',
    dept: 'CS',
    level: 300,
    category: 'CORE',
    credits: 4,
    prereqs: [['CS203'], ['CS201']],
  },
  {
    code: 'CS303',
    title: 'Database Systems',
    dept: 'CS',
    level: 300,
    category: 'CORE',
    credits: 4,
    prereqs: [['CS201']],
  },
  {
    code: 'CS304',
    title: 'Computer Networks',
    dept: 'CS',
    level: 300,
    category: 'CORE',
    credits: 4,
    prereqs: [['CS302', 'CS203']],
  },
  {
    code: 'CS305',
    title: 'Theory of Computation',
    dept: 'CS',
    level: 300,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS202']],
  },
  {
    code: 'CS306',
    title: 'Software Engineering Principles',
    dept: 'CS',
    level: 300,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS201']],
  },
  {
    code: 'CS401',
    title: 'Machine Learning',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS301'], ['MATH202']],
  },
  {
    code: 'CS402',
    title: 'Distributed Systems',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS302'], ['CS304']],
  },
  {
    code: 'CS403',
    title: 'Compiler Design',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS305'], ['CS301']],
  },
  {
    code: 'CS404',
    title: 'Information Security',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS304']],
  },
  {
    code: 'CS405',
    title: 'Computer Graphics',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS201'], ['MATH102']],
  },
  {
    code: 'CS406',
    title: 'Artificial Intelligence',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS301']],
  },
  {
    code: 'CS490',
    title: 'Computer Science Capstone Project',
    dept: 'CS',
    level: 400,
    category: 'PROJECT',
    credits: 6,
    prereqs: [[['CS301', 'C']]],
  },
  {
    code: 'CS407',
    title: 'Cloud Computing',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS402']],
    status: 'DRAFT',
  },
  {
    code: 'CS408',
    title: 'Quantum Computing',
    dept: 'CS',
    level: 400,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['MATH102'], ['CS301']],
    status: 'DRAFT',
  },
  {
    code: 'CS209',
    title: 'Programming in COBOL',
    dept: 'CS',
    level: 200,
    category: 'ELECTIVE',
    credits: 3,
    prereqs: [['CS101']],
    status: 'INACTIVE',
  },
];

const ENGINEERING = new Set([
  'SE',
  'CS',
  'EE',
  'ME',
  'EL',
  'ECE',
  'CE',
  'CHE',
  'AE',
  'BME',
  'AIDS',
  'RA',
]);
const SEQ = [101, 102, 201, 202, 301, 302, 401, 402];

function generatedCatalog(): CourseSpec[] {
  const list: CourseSpec[] = [];
  for (const [dept, titles] of Object.entries(CATALOG)) {
    titles.forEach((title, i) => {
      const number = SEQ[i]!;
      const lab = /laboratory|studio|workshop practice/i.test(title);
      const project = /capstone|thesis|project|internship|portfolio/i.test(title);
      const seminar = /seminar/i.test(title);
      const category: CourseCategory = lab
        ? 'LABORATORY'
        : project
          ? title.includes('Internship')
            ? 'INTERNSHIP'
            : 'PROJECT'
          : seminar
            ? 'SEMINAR'
            : i < 4
              ? 'CORE'
              : i % 2 === 0
                ? 'CORE'
                : 'ELECTIVE';
      const credits = lab ? 2 : project ? 6 : category === 'CORE' ? 4 : 3;
      // Each course builds on the one two steps earlier; second-year engineering also needs calculus.
      const prereqs: Prereq = [];
      if (i >= 2 && !lab) {
        const previous = SEQ[i - 2]!;
        const prevTitle = titles[i - 2]!;
        prereqs.push(
          /laboratory|studio|workshop practice/i.test(prevTitle)
            ? [`${dept}${SEQ[i - 3] ?? previous}`]
            : [`${dept}${previous}`],
        );
      }
      if (i === 2 && ENGINEERING.has(dept)) prereqs.push(['MATH101', 'MATH102']);
      list.push({
        code: `${dept}${number}`,
        title,
        dept,
        level: Math.floor(number / 100) * 100,
        category,
        credits,
        prereqs,
        coreqs: lab && i % 2 === 1 ? [`${dept}${SEQ[i - 1]}`] : [],
      });
    });
  }
  return list;
}

function outcomesFor(title: string): string[] {
  const topic = title.replace(/ (I|II|III)$/, '').toLowerCase();
  return [
    `Explain the core concepts and vocabulary of ${topic}.`,
    `Apply the methods of ${topic} to well-defined problems.`,
    `Analyse and communicate results clearly in written and oral form.`,
  ];
}
function assessmentFor(category: CourseCategory) {
  if (category === 'LABORATORY')
    return [
      { name: 'Lab exercises', weight: 60 },
      { name: 'Viva voce', weight: 40 },
    ];
  if (category === 'PROJECT' || category === 'INTERNSHIP')
    return [
      { name: 'Progress reviews', weight: 40 },
      { name: 'Final report', weight: 30 },
      { name: 'Presentation', weight: 30 },
    ];
  return [
    { name: 'Assignments', weight: 25 },
    { name: 'Mid-session examination', weight: 30 },
    { name: 'End-session examination', weight: 45 },
  ];
}

// ----- classrooms -------------------------------------------------------------

const BUILDINGS: Array<{
  campus: string;
  building: string;
  prefix: string;
  rooms: Array<[ClassroomType, number, number]>;
}> = [
  {
    campus: 'MAIN',
    building: 'Engineering Block A',
    prefix: 'A',
    rooms: [
      ['CLASSROOM', 10, 70],
      ['LECTURE_HALL', 3, 150],
      ['COMPUTER_LAB', 4, 60],
      ['LABORATORY', 4, 40],
    ],
  },
  {
    campus: 'MAIN',
    building: 'Engineering Block B',
    prefix: 'B',
    rooms: [
      ['CLASSROOM', 10, 60],
      ['LABORATORY', 6, 40],
      ['SEMINAR_ROOM', 2, 30],
    ],
  },
  {
    campus: 'MAIN',
    building: 'Science Block',
    prefix: 'S',
    rooms: [
      ['CLASSROOM', 8, 60],
      ['LABORATORY', 5, 40],
      ['LECTURE_HALL', 2, 120],
    ],
  },
  {
    campus: 'MAIN',
    building: 'Business School',
    prefix: 'M',
    rooms: [
      ['CLASSROOM', 6, 60],
      ['SEMINAR_ROOM', 2, 30],
    ],
  },
  {
    campus: 'MAIN',
    building: 'Design Studios',
    prefix: 'D',
    rooms: [
      ['STUDIO', 4, 40],
      ['CLASSROOM', 2, 50],
    ],
  },
  { campus: 'MAIN', building: 'Convocation Hall', prefix: 'H', rooms: [['AUDITORIUM', 1, 600]] },
  {
    campus: 'NORTH',
    building: 'Humanities Block',
    prefix: 'HU',
    rooms: [
      ['CLASSROOM', 10, 60],
      ['SEMINAR_ROOM', 4, 30],
      ['STUDIO', 2, 30],
      ['LABORATORY', 1, 30],
    ],
  },
  {
    campus: 'NORTH',
    building: 'Law School',
    prefix: 'L',
    rooms: [
      ['CLASSROOM', 5, 80],
      ['SEMINAR_ROOM', 2, 30],
    ],
  },
  {
    campus: 'NORTH',
    building: 'Medical Sciences Block',
    prefix: 'MS',
    rooms: [
      ['CLASSROOM', 6, 100],
      ['LABORATORY', 5, 40],
      ['LECTURE_HALL', 1, 150],
    ],
  },
];
const EQUIPMENT: Partial<Record<ClassroomType, string[]>> = {
  CLASSROOM: ['Projector', 'Whiteboard'],
  LECTURE_HALL: ['Projector', 'PA system', 'Lecture capture'],
  COMPUTER_LAB: ['Workstations', 'Projector'],
  LABORATORY: ['Fume hoods', 'Lab benches'],
  SEMINAR_ROOM: ['Display screen', 'Video conferencing'],
  STUDIO: ['Drafting tables', 'Natural light'],
  AUDITORIUM: ['Stage', 'PA system'],
};

async function seedClassrooms() {
  const campuses = new Map(
    (await prisma.campus.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]),
  );
  let created = 0;
  for (const b of BUILDINGS) {
    let n = 1;
    for (const [type, count, capacity] of b.rooms) {
      for (let i = 0; i < count; i++, n++) {
        const roomNumber = `${b.prefix}-${String(100 + n)}`;
        const campusId = campuses.get(b.campus)!;
        const exists = await prisma.classroom.findUnique({
          where: { campusId_building_roomNumber: { campusId, building: b.building, roomNumber } },
        });
        if (exists) continue;
        await prisma.classroom.create({
          data: {
            campusId,
            building: b.building,
            roomNumber,
            capacity,
            type,
            equipment: EQUIPMENT[type] ?? [],
          },
        });
        created++;
      }
    }
  }
  return created;
}

// ----- courses ----------------------------------------------------------------

async function seedCourses() {
  const specs = [...CURATED, ...generatedCatalog()];
  const departments = new Map(
    (await prisma.department.findMany({ select: { id: true, code: true, headId: true } })).map(
      (d) => [d.code, d],
    ),
  );
  const facultyByDept = new Map<string, string[]>();
  for (const f of await prisma.facultyMember.findMany({
    where: { employmentStatus: 'ACTIVE' },
    select: { id: true, department: { select: { code: true } } },
    orderBy: { employeeNumber: 'asc' },
  })) {
    const list = facultyByDept.get(f.department.code) ?? [];
    list.push(f.id);
    facultyByDept.set(f.department.code, list);
  }
  const ids = new Map(
    (await prisma.course.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]),
  );
  let created = 0;
  for (const spec of specs) {
    if (ids.has(spec.code)) continue;
    const dept = departments.get(spec.dept);
    if (!dept) continue;
    const pool = facultyByDept.get(spec.dept) ?? [];
    const coordinatorId =
      spec.level >= 300 && pool.length ? pool[Math.floor(rand() * pool.length)]! : dept.headId;
    const row = await prisma.course.create({
      data: {
        code: spec.code,
        title: spec.title,
        description:
          spec.description ??
          `${spec.title} for students of ${spec.dept === 'MATH' ? 'mathematics and engineering' : 'the department'}: concepts, methods and applications, with regular problem sets and assessed work.`,
        departmentId: dept.id,
        credits: spec.credits,
        level: spec.level,
        category: spec.category,
        recommendedYear: spec.level / 100,
        recommendedSessionType: Math.floor(spec.level / 100) % 2 === 1 ? 'FALL' : 'SPRING',
        defaultCapacity: spec.category === 'LABORATORY' ? 30 : spec.level <= 200 ? 60 : 40,
        minEnrollment: spec.category === 'PROJECT' ? 1 : 8,
        coordinatorId,
        isRepeatable: spec.category === 'SEMINAR',
        status: spec.status ?? 'ACTIVE',
        outcomes: {
          create: outcomesFor(spec.title).map((description, position) => ({
            description,
            position,
          })),
        },
        assessmentComponents: {
          create: assessmentFor(spec.category).map((a, position) => ({ ...a, position })),
        },
      },
    });
    ids.set(spec.code, row.id);
    created++;
  }
  if (created === 0) return { created, ids };

  // Relationships, only for courses created in this run.
  for (const spec of specs) {
    const courseId = ids.get(spec.code);
    if (!courseId || (await prisma.prerequisiteGroup.count({ where: { courseId } })) > 0) continue;
    for (const [position, group] of (spec.prereqs ?? []).entries()) {
      const items = group
        .map((item) => (typeof item === 'string' ? [item, null] : item) as [string, string | null])
        .filter(([code]) => ids.has(code));
      if (!items.length) continue;
      await prisma.prerequisiteGroup.create({
        data: {
          courseId,
          position,
          items: {
            create: items.map(([code, grade]) => ({
              requiredCourseId: ids.get(code)!,
              minGradeLetter: grade,
            })),
          },
        },
      });
    }
    const coreqs = (spec.coreqs ?? []).filter((c) => ids.has(c));
    if (coreqs.length)
      await prisma.courseCorequisite.createMany({
        data: coreqs.map((c) => ({ courseId, corequisiteId: ids.get(c)! })),
        skipDuplicates: true,
      });
  }

  // Program mappings: each program maps its department's courses (core vs elective),
  // engineering programs also map first-year mathematics.
  const programs = await prisma.program.findMany({
    include: { department: { select: { code: true } }, degree: { select: { level: true } } },
  });
  for (const p of programs) {
    const deptSpecs = specs.filter(
      (s) => s.dept === p.department.code && s.status !== 'DRAFT' && s.status !== 'INACTIVE',
    );
    const levelOk = (s: CourseSpec) => (p.degree.level === 'UNDERGRADUATE' ? true : s.level >= 300);
    const mapped = deptSpecs.filter(levelOk);
    if (ENGINEERING.has(p.department.code) && p.degree.level === 'UNDERGRADUATE')
      mapped.push(
        ...CURATED.filter(
          (s) => s.code === 'MATH101' || s.code === 'MATH102' || s.code === 'MATH202',
        ),
      );
    await prisma.courseProgram.createMany({
      data: mapped.map((s) => ({
        courseId: ids.get(s.code)!,
        programId: p.id,
        mappingType: s.category === 'ELECTIVE' || s.category === 'SEMINAR' ? 'ELECTIVE' : 'CORE',
      })),
      skipDuplicates: true,
    });
  }

  // Computer Science specializations map relevant upper-level electives.
  const csSpecs = await prisma.specialization.findMany({
    where: { program: { code: 'BTECH-CS' } },
    select: { id: true, name: true },
  });
  const bySpec: Array<[RegExp, string[]]> = [
    [/artificial|machine|data|intelligence/i, ['CS401', 'CS406', 'MATH202']],
    [/security|cyber/i, ['CS404', 'CS304', 'CS402']],
    [/systems|cloud|network|software/i, ['CS402', 'CS306', 'CS304']],
  ];
  for (const s of csSpecs) {
    const codes = bySpec.find(([re]) => re.test(s.name))?.[1] ?? ['CS401'];
    await prisma.courseSpecialization.createMany({
      data: codes
        .filter((c) => ids.has(c))
        .map((c) => ({
          courseId: ids.get(c)!,
          specializationId: s.id,
          mappingType: 'CORE' as const,
        })),
      skipDuplicates: true,
    });
  }

  // ALL_OF requirement groups list the program department's 100/200-level core courses;
  // CREDITS_FROM_LIST groups list its upper-level electives.
  const groups = await prisma.requirementGroup.findMany({
    where: { kind: { in: ['ALL_OF', 'CREDITS_FROM_LIST'] }, courses: { none: {} } },
    include: {
      program: { select: { department: { select: { code: true } } } },
      specialization: {
        select: { program: { select: { department: { select: { code: true } } } } },
      },
    },
  });
  for (const g of groups) {
    const dept = g.program?.department.code ?? g.specialization?.program.department.code;
    const candidates = specs.filter(
      (s) => s.dept === dept && s.status !== 'DRAFT' && s.status !== 'INACTIVE',
    );
    const chosen =
      g.kind === 'ALL_OF'
        ? candidates.filter((s) => s.level <= 200 && s.category !== 'ELECTIVE')
        : candidates.filter((s) => s.level >= 300 && s.category !== 'PROJECT');
    await prisma.requirementCourse.createMany({
      data: chosen.map((s) => ({ requirementGroupId: g.id, courseId: ids.get(s.code)! })),
      skipDuplicates: true,
    });
  }
  return { created, ids };
}

// ----- sections ---------------------------------------------------------------

type Slot = { days: number[]; start: number; length: number };
/** Weekly patterns: Mon/Wed/Fri 60 min, Tue/Thu 90 min, single-day 120-min labs. */
const LECTURE_SLOTS: Slot[] = [];
for (const start of [480, 540, 600, 660, 720, 840, 900, 960])
  LECTURE_SLOTS.push({ days: [1, 3, 5], start, length: 60 });
for (const start of [480, 570, 660, 840, 930])
  LECTURE_SLOTS.push({ days: [2, 4], start, length: 90 });
const LAB_SLOTS: Slot[] = [];
for (const day of [1, 2, 3, 4, 5])
  for (const start of [840, 960]) LAB_SLOTS.push({ days: [day], start, length: 120 });

class Occupancy {
  private used = new Set<string>();
  private key(resource: string, day: number, minute: number) {
    return `${resource}|${day}|${minute}`;
  }
  /** Occupancy is tracked in 30-minute blocks. */
  private blocks(slot: Slot) {
    const out: Array<[number, number]> = [];
    for (const day of slot.days)
      for (let m = slot.start; m < slot.start + slot.length; m += 30) out.push([day, m]);
    return out;
  }
  free(resource: string, slot: Slot) {
    return this.blocks(slot).every(([d, m]) => !this.used.has(this.key(resource, d, m)));
  }
  take(resource: string, slot: Slot) {
    for (const [d, m] of this.blocks(slot)) this.used.add(this.key(resource, d, m));
  }
}

const SCHOOL_CAMPUS: Record<string, string> = {
  ENG: 'MAIN',
  SCI: 'MAIN',
  BUS: 'MAIN',
  ARC: 'MAIN',
  LAW: 'NORTH',
  ART: 'NORTH',
  SOC: 'NORTH',
  MED: 'NORTH',
  EDU: 'NORTH',
};

export async function seedSessionSections(
  sessionCode: string,
  options: { levels: number[]; status: SectionStatus; publishShare: number; multiSection: boolean },
) {
  const session = await prisma.academicSession.findUnique({ where: { code: sessionCode } });
  if (!session || (await prisma.courseSection.count({ where: { sessionId: session.id } })) > 0)
    return 0;
  const courses = await prisma.course.findMany({
    where: { status: 'ACTIVE', level: { in: options.levels } },
    include: { department: { select: { code: true, school: { select: { code: true } } } } },
    orderBy: { code: 'asc' },
  });
  const rooms = await prisma.classroom.findMany({
    where: { status: 'ACTIVE' },
    include: { campus: { select: { code: true, id: true } } },
    orderBy: [{ capacity: 'asc' }, { roomNumber: 'asc' }],
  });
  const faculty = await prisma.facultyMember.findMany({
    where: { employmentStatus: 'ACTIVE' },
    select: {
      id: true,
      maxLoadCredits: true,
      department: { select: { code: true } },
      user: { select: { email: true } },
    },
    orderBy: { employeeNumber: 'asc' },
  });
  const devFacultyId = faculty.find((f) => f.user.email === 'faculty.cs@ucrams.local')?.id;
  const load = new Map<string, number>();
  const occ = new Occupancy();
  let created = 0;
  for (const course of courses) {
    const lab = course.category === 'LABORATORY';
    const credits = course.credits.toNumber();
    const count =
      options.multiSection && course.level === 100 && !lab ? 2 + Math.floor(rand() * 2) : 1;
    const campusCode = SCHOOL_CAMPUS[course.department.school.code] ?? 'MAIN';
    for (let n = 0; n < count; n++) {
      const sectionCode = String.fromCharCode(65 + n);
      const capacity = lab
        ? 30
        : course.level <= 200
          ? 60
          : course.category === 'PROJECT'
            ? 20
            : 40;
      const slots = lab ? LAB_SLOTS : LECTURE_SLOTS;
      const roomTypes: ClassroomType[] = lab
        ? course.department.code === 'CS' ||
          course.department.code === 'SE' ||
          course.department.code === 'AIDS'
          ? ['COMPUTER_LAB', 'LABORATORY']
          : ['LABORATORY', 'COMPUTER_LAB', 'STUDIO']
        : ['CLASSROOM', 'LECTURE_HALL', 'SEMINAR_ROOM', 'STUDIO'];
      const candidates = rooms.filter(
        (r) => r.campus.code === campusCode && roomTypes.includes(r.type) && r.capacity >= capacity,
      );
      const teachers = faculty.filter(
        (f) =>
          f.department.code === course.department.code &&
          (load.get(f.id) ?? 0) + credits <= (f.maxLoadCredits?.toNumber() ?? 12),
      );
      // The dev faculty account teaches the first CS sections so the faculty portal has data.
      if (devFacultyId && course.department.code === 'CS') {
        const i = teachers.findIndex((t) => t.id === devFacultyId);
        if (i > 0) teachers.unshift(...teachers.splice(i, 1));
      }
      const offset = Math.floor(rand() * slots.length);
      let placed: { slot: Slot; roomId: string; teacher: string | null } | null = null;
      for (let k = 0; k < slots.length && !placed; k++) {
        const slot = slots[(offset + k) % slots.length]!;
        const room = candidates.find((r) => occ.free(r.id, slot));
        if (!room) continue;
        const teacher = teachers.find((t) => occ.free(t.id, slot))?.id ?? null;
        placed = { slot, roomId: room.id, teacher };
      }
      if (!placed) continue;
      occ.take(placed.roomId, placed.slot);
      if (placed.teacher) {
        occ.take(placed.teacher, placed.slot);
        load.set(placed.teacher, (load.get(placed.teacher) ?? 0) + credits);
      }
      const status: SectionStatus =
        options.status === 'PUBLISHED' && (rand() > options.publishShare || !placed.teacher)
          ? 'DRAFT'
          : options.status;
      const meetingType: MeetingType = lab
        ? 'LAB'
        : course.category === 'SEMINAR'
          ? 'SEMINAR'
          : 'LECTURE';
      await prisma.courseSection.create({
        data: {
          courseId: course.id,
          sessionId: session.id,
          sectionCode,
          capacity,
          waitlistCapacity: lab ? 5 : 10,
          campusId: rooms.find((r) => r.id === placed!.roomId)!.campus.id,
          status,
          registrationOpen: status === 'PUBLISHED',
          publishedAt: status === 'DRAFT' ? null : session.startDate,
          meetings: {
            create: placed.slot.days.map((dayOfWeek) => ({
              dayOfWeek,
              startMinute: placed!.slot.start,
              endMinute: placed!.slot.start + placed!.slot.length,
              type: meetingType,
              classroomId: placed!.roomId,
            })),
          },
          instructors: placed.teacher
            ? { create: [{ facultyMemberId: placed.teacher, role: 'PRIMARY' }] }
            : undefined,
        },
      });
      created++;
    }
  }
  return created;
}

export async function seedCatalog() {
  const classrooms = await seedClassrooms();
  const { created: courses } = await seedCourses();
  const completedFall = await seedSessionSections('FALL-2025', {
    levels: [100, 300],
    status: 'COMPLETED',
    publishShare: 1,
    multiSection: false,
  });
  const completedSpring = await seedSessionSections('SPRING-2026', {
    levels: [200, 400],
    status: 'COMPLETED',
    publishShare: 1,
    multiSection: false,
  });
  const active = await seedSessionSections('FALL-2026', {
    levels: [100, 200, 300, 400],
    status: 'PUBLISHED',
    publishShare: 0.93,
    multiSection: true,
  });
  // Two cancelled sections in the active session, for realistic lists.
  const session = await prisma.academicSession.findUnique({ where: { code: 'FALL-2026' } });
  if (active && session) {
    const victims = await prisma.courseSection.findMany({
      where: { sessionId: session.id, status: 'PUBLISHED', course: { level: 400 } },
      take: 2,
      orderBy: { id: 'desc' },
    });
    for (const v of victims)
      await prisma.courseSection.update({
        where: { id: v.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date('2026-07-20T10:00:00Z'),
          cancelReason: 'Instructor unavailable this session',
          registrationOpen: false,
        },
      });
  }
  return { classrooms, courses, sections: completedFall + completedSpring + active };
}
