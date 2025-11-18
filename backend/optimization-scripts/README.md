# Schedule Optimization with Google OR-Tools

This directory contains the Python-based schedule optimizer using Google OR-Tools CP-SAT solver, inspired by the PoliTO_Timetable_Allocator constraint programming approach.

## Architecture

```
┌─────────────────┐
│   Node.js API   │  (TypeScript)
│ ScheduleService │
└────────┬────────┘
         │
         │ JSON via stdin/stdout
         ▼
┌─────────────────┐
│  Python Script  │  (schedule_optimizer.py)
│  OR-Tools CP-SAT│
└────────┬────────┘
         │
         │ Optimal Solution
         ▼
┌─────────────────┐
│   Database      │  (MySQL)
│  Assignments    │
└─────────────────┘
```

## Prerequisites

### 1. Python 3.8+

Check if Python is installed:
```bash
python3 --version
```

If not installed:
- **macOS**: `brew install python3`
- **Linux**: `sudo apt-get install python3 python3-pip`
- **Windows**: Download from [python.org](https://python.org)

### 2. Install Python Dependencies

From the backend directory:

```bash
# Install OR-Tools and dependencies
pip3 install -r optimization-scripts/requirements.txt
```

Or install individually:
```bash
pip3 install ortools>=9.8.0
pip3 install python-dateutil>=2.8.2
```

### 3. Verify Installation

Test the optimizer:
```bash
cd backend/optimization-scripts

# Create a simple test problem
cat > test_problem.json << 'EOF'
{
  "shifts": [
    {
      "id": "1",
      "date": "2025-11-15",
      "start_time": "08:00",
      "end_time": "16:00",
      "min_staff": 2,
      "max_staff": 3,
      "required_skills": ["General"]
    },
    {
      "id": "2",
      "date": "2025-11-15",
      "start_time": "16:00",
      "end_time": "00:00",
      "min_staff": 1,
      "max_staff": 2,
      "required_skills": ["General"]
    }
  ],
  "employees": [
    {
      "id": "1",
      "max_hours_per_week": 40,
      "skills": ["General"],
      "unavailable_dates": [],
      "max_consecutive_days": 5
    },
    {
      "id": "2",
      "max_hours_per_week": 40,
      "skills": ["General"],
      "unavailable_dates": [],
      "max_consecutive_days": 5
    },
    {
      "id": "3",
      "max_hours_per_week": 40,
      "skills": ["General"],
      "unavailable_dates": [],
      "max_consecutive_days": 5
    }
  ],
  "preferences": {
    "1": {
      "preferred_shifts": ["1"],
      "avoid_shifts": []
    },
    "2": {
      "preferred_shifts": ["2"],
      "avoid_shifts": []
    }
  }
}
EOF

# Run optimizer
python3 schedule_optimizer.py test_problem.json test_solution.json

# Check output
cat test_solution.json
```

Expected output:
```json
{
  "status": "OPTIMAL" or "FEASIBLE",
  "assignments": [
    {
      "employee_id": "1",
      "shift_id": "1",
      "date": "2025-11-15",
      "start_time": "08:00",
      "end_time": "16:00",
      "hours": 8
    },
    ...
  ],
  "statistics": {
    "coverage_stats": {
      "coverage_percentage": 100
    }
  }
}
```

## OR-Tools CP-SAT Approach (Inspired by PoliTO)

### Constraint Programming Model

The optimizer uses Google OR-Tools CP-SAT (Constraint Programming - Satisfiability) solver with:

**Boolean Variables:**
- `assign[employee, shift]` = 1 if employee assigned to shift, 0 otherwise

**Hard Constraints:**
1. **Shift Coverage**: Each shift has min-max staff requirements
   ```python
   min_staff ≤ Σ assign[employee, shift] ≤ max_staff
   ```

2. **No Double-Booking**: Employee cannot work overlapping shifts
   ```python
   Σ assign[employee, overlapping_shifts] ≤ 1
   ```

3. **Skill Requirements**: Only employees with required skills can be assigned
   ```python
   If skills_required ⊄ employee_skills: assign[employee, shift] = 0
   ```

4. **Availability**: Employees cannot work when unavailable
   ```python
   If date ∈ unavailable_dates: assign[employee, shift] = 0
   ```

5. **Max Hours per Week**: Weekly hour limits
   ```python
   Σ (assign[employee, shift] × hours[shift]) ≤ max_hours_per_week
   ```

**Soft Constraints (Objective Function):**

Maximizes weighted sum (inspired by PoliTO's correlation-based approach):

```python
Maximize: 
  + preference_weight × Σ (assign × preference_score)      # Employee preferences (like PoliTO correlations)
  + fairness_weight × fairness_score                       # Workload balance
  - consecutive_penalty × consecutive_violations           # Too many consecutive days
  + continuity_bonus × shift_continuity                    # Prefer regular patterns
```

### Comparison with PoliTO Approach

| Aspect | PoliTO (Teachers/Courses) | StaffScheduler (Employees/Shifts) |
|--------|---------------------------|-----------------------------------|
| **Solver** | IBM CPLEX docplex | Google OR-Tools CP-SAT |
| **Main Variables** | Teaching assignments | Shift assignments |
| **Coverage** | Each teaching must be covered | Each shift needs min-max staff |
| **Conflicts** | Teacher availability slots | Overlapping shifts |
| **Preferences** | Teaching correlations (weights) | Shift preferences (weights) |
| **Dispersion** | Lecture dispersion penalty | Consecutive days penalty |
| **Objective** | Weighted correlations sum | Weighted preferences sum |

### Key Design Decisions

1. **Why CP-SAT over Linear Programming?**
   - Better for scheduling problems with discrete decisions
   - Handles logical constraints (if-then) naturally
   - Fast for feasibility checking

2. **Why Python Bridge?**
   - OR-Tools has mature Python bindings (no native Node.js)
   - Easy to maintain and test separately
   - Can reuse PoliTO patterns more directly

3. **Constraint Weights (from PoliTO Parameters.py)**
   ```python
   shift_coverage: 100        # Critical (like teaching_coverage_penalty)
   no_double_booking: 90      # Critical
   employee_preferences: 55   # Important (like teaching_overlaps_penalty: 50)
   consecutive_days: 30       # Nice to have (like lecture_dispersion_penalty: 25)
   ```

## Troubleshooting

### Python Not Found
```bash
# macOS/Linux: Create symlink if needed
which python3
# Add to PATH if necessary
```

### OR-Tools Installation Failed
```bash
# Upgrade pip first
pip3 install --upgrade pip

# Install with verbose logging
pip3 install -v ortools

# If still fails, check Python version (need 3.8+)
python3 --version
```

### Optimizer Times Out
- Increase time limit: `--time-limit 600` (10 minutes)
- Reduce problem size (fewer shifts or employees)
- Relax some constraints

### Infeasible Solution
Check logs for violated constraints:
- Insufficient employees with required skills
- Too many unavailable dates
- Max hours too restrictive

## Integration with Node.js

The TypeScript wrapper (`ScheduleOptimizerORTools.ts`) handles:

1. **Data Preparation**: Converts database models to JSON format
2. **Process Management**: Spawns Python process, pipes stdin/stdout
3. **Error Handling**: Catches Python errors, provides fallback greedy algorithm
4. **Result Processing**: Parses JSON solution, stores in database

Example usage:
```typescript
import scheduleOptimizer from './optimization/ScheduleOptimizerORTools';

const problem = {
  shifts: await getShiftsFromDB(),
  employees: await getEmployeesFromDB(),
  preferences: await getPreferencesFromDB()
};

const result = await scheduleOptimizer.optimize(problem, {
  timeLimitSeconds: 300,
  weights: {
    employeePreferences: 60,  // Customize weights
    workloadFairness: 45
  }
});

if (result.status === 'OPTIMAL' || result.status === 'FEASIBLE') {
  await saveAssignmentsToDB(result.assignments);
}
```

## Performance Benchmarks

Typical solve times on modern hardware:

- **Small** (10 employees, 50 shifts): < 5 seconds
- **Medium** (50 employees, 200 shifts): 30-120 seconds
- **Large** (100 employees, 500 shifts): 2-10 minutes

CP-SAT is highly parallelized and will use all available CPU cores.

## References

- [Google OR-Tools Documentation](https://developers.google.com/optimization)
- [CP-SAT Solver Guide](https://developers.google.com/optimization/cp/cp_solver)
- [PoliTO Timetable Allocator](https://github.com/Paolino01/PoliTO_Timetable_Allocator) - Inspiration source
- [Employee Scheduling Problem](https://developers.google.com/optimization/scheduling/employee_scheduling)
